/**
 * 面板用的本地接口：挂着 `/tapd` 前缀路由（由宿主 web server 提供）。
 *
 *   GET  /tapd/__config                     读有效配置（密钥只回存在性标记）
 *   PUT  /tapd/__config                     合并并保存配置到 $DSH_HOME/tapd/config.json
 *   POST /tapd/__test                       用当前配置真打一次 TAPD，验证凭据
 *   GET  /tapd/__stories?keyword=&status=   需求列表（含可粘贴的引用 token）
 *   GET  /tapd/__story?id=                  单条需求全文
 *
 * 浏览器只和这个同源前缀打交道，凭据留在 Node 侧，不进入跨域请求。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { TapdClient, TapdError } from './tapd.js'
import type { TapdStory } from './tapd.js'
import { publicConfig, writeStore, resolveConfig } from './store.js'
import type { StoredConfig } from './store.js'
import { formatReference } from './reference.js'

/** 挂在宿主上的路由前缀。 */
export const ROUTE_PATH = '/tapd'
/** 配置读写端点。 */
const CONFIG_PATH = '/__config'
/** 凭据探活端点。 */
const TEST_PATH = '/__test'
/** 需求列表端点。 */
const STORIES_PATH = '/__stories'
/** 单条需求端点。 */
const STORY_PATH = '/__story'

/** 宿主 web server 的最小接口，避免把 dsh-host-webserver 变成硬依赖。 */
interface WebServerLike {
  register(route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }): () => void
}

/**
 * 把路由注册到宿主 web server。
 * @param webServer 宿主的 web server 服务
 * @param rowConfig 插件行上的 config，作为 store 与环境变量之间的兜底
 */
export function registerRoutes(webServer: WebServerLike, rowConfig: StoredConfig): () => void {
  return webServer.register({
    kind: 'prefix',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sub = url.pathname.slice(ROUTE_PATH.length) || '/'
      try {
        if (sub === CONFIG_PATH) {
          if (req.method === 'GET') return sendJson(res, 200, { config: publicConfig(rowConfig) })
          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await readJson(req)
            const patch = asPatch(body)
            writeStore(patch)
            return sendJson(res, 200, { config: publicConfig(rowConfig), saved: Object.keys(patch) })
          }
          return sendJson(res, 405, { error: '不支持的请求方法' })
        }

        if (sub === TEST_PATH && req.method === 'POST') return await runTest(res, rowConfig)

        if (sub === STORIES_PATH && req.method === 'GET') return await runStories(res, url, rowConfig)

        if (sub === STORY_PATH && req.method === 'GET') return await runStory(res, url, rowConfig)

        return sendJson(res, 404, { error: `未知端点 ${sub}` })
      } catch (error) {
        const message = error instanceof TapdError ? error.message : String((error as Error)?.message ?? error)
        sendJson(res, 502, { error: message })
      }
    },
  })
}

/** 用当前有效配置构造一个 TAPD 客户端。 */
export function createClient(rowConfig: StoredConfig = {}, timeoutMs?: number): TapdClient {
  const { resolved } = resolveConfig(rowConfig)
  return new TapdClient({
    auth: {
      ...(resolved.apiUser ? { user: resolved.apiUser } : {}),
      ...(resolved.apiPassword ? { password: resolved.apiPassword } : {}),
      ...(resolved.apiToken ? { token: resolved.apiToken } : {}),
    },
    ...(resolved.workspaceId ? { defaultWorkspaceId: resolved.workspaceId } : {}),
    baseUrl: resolved.baseUrl,
    ...(timeoutMs ? { timeoutMs } : {}),
  })
}

/** 真打一次 TAPD（limit=1），把凭据 / 项目 ID 的问题当场暴露给面板。 */
async function runTest(res: ServerResponse, rowConfig: StoredConfig): Promise<void> {
  const client = createClient(rowConfig)
  const view = publicConfig(rowConfig)
  if (!view.configured) {
    sendJson(res, 200, {
      ok: false,
      error: '还没填鉴权：TAPD 免费版填「个人访问令牌」即可（个人设置 → 个人访问令牌）；付费版也可用开放应用 ID + 秘钥',
    })
    return
  }
  if (!view.workspaceId) {
    sendJson(res, 200, { ok: false, error: '还没填项目 ID' })
    return
  }
  try {
    const stories = await client.listStories({ limit: 1 })
    sendJson(res, 200, {
      ok: true,
      workspaceId: view.workspaceId,
      count: stories.length,
      ...(stories[0]?.name ? { sample: stories[0].name } : {}),
    })
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      error: error instanceof TapdError ? error.message : String(error),
      ...(error instanceof TapdError && error.status ? { status: error.status } : {}),
    })
  }
}

/** 需求列表；每条都带上 `@tapd:story:<id>` 引用 token，面板可一键复制。 */
async function runStories(res: ServerResponse, url: URL, rowConfig: StoredConfig): Promise<void> {
  const client = createClient(rowConfig)
  const view = publicConfig(rowConfig)
  if (!view.configured) {
    sendJson(res, 200, { configured: false, stories: [] })
    return
  }
  const stories = await client.listStories({
    ...(url.searchParams.get('keyword') ? { name: url.searchParams.get('keyword') as string } : {}),
    ...(url.searchParams.get('status') ? { status: url.searchParams.get('status') as string } : {}),
    ...(url.searchParams.get('owner') ? { owner: url.searchParams.get('owner') as string } : {}),
    limit: clampInt(url.searchParams.get('limit'), 20, 1, 200),
    page: clampInt(url.searchParams.get('page'), 1, 1, 1000),
  })
  sendJson(res, 200, {
    configured: true,
    workspaceId: view.workspaceId,
    stories: stories.map(summarize),
  })
}

/** 单条需求全文。 */
async function runStory(res: ServerResponse, url: URL, rowConfig: StoredConfig): Promise<void> {
  const id = url.searchParams.get('id')?.trim()
  if (!id) {
    sendJson(res, 200, { error: '缺少 id' })
    return
  }
  const client = createClient(rowConfig)
  const story = await client.getStory(id)
  sendJson(res, 200, { story: { ...story, reference: formatReference(story) } })
}

/** 列表行：描述截断，避免一次把几十条正文传进浏览器。 */
function summarize(story: TapdStory): TapdStory & { reference: string; summary: string } {
  const body = (story.description ?? '').replace(/\s+/g, ' ').trim()
  return {
    ...story,
    description: undefined,
    summary: body.length > 120 ? `${body.slice(0, 120)}…` : body,
    reference: formatReference(story),
  }
}

function asPatch(body: unknown): StoredConfig {
  if (!body || typeof body !== 'object') return {}
  const input = body as Record<string, unknown>
  const patch: StoredConfig = {}
  for (const key of ['apiUser', 'apiPassword', 'apiToken', 'workspaceId', 'baseUrl'] as const) {
    const value = input[key]
    if (typeof value === 'string') patch[key] = value
  }
  return patch
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer))
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new TapdError('请求体不是合法 JSON')
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}
