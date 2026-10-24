/**
 * 面板用的本地接口：挂着 `/tapd` 前缀路由（由宿主 web server 提供）。
 *
 *   GET  /tapd/__config                     读有效配置（密钥只回存在性标记）
 *   PUT  /tapd/__config                     合并并保存配置到 $DSH_HOME/tapd/config.json
 *   POST /tapd/__test                       用当前配置真打一次 TAPD，验证凭据
 *   GET  /tapd/__stories?keyword=&status=   需求列表（含可粘贴的引用 token，带总数与是否还有下一页）
 *   GET  /tapd/__story?id=                  单条需求全文
 *   GET  /tapd/__filters                    筛选器的选项：状态表 / 迭代 / 成员
 *   GET  /tapd/__image?path=                需求正文里的图片（宿主用令牌换成签名地址再转发字节）
 *
 * 浏览器只和这个同源前缀打交道，凭据留在 Node 侧，不进入跨域请求。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { TapdClient, TapdError } from './tapd.js'
import type { TapdStory } from './tapd.js'
import { publicConfig, writeStore, resolveConfig } from './store.js'
import type { ResolvedConfig, StoredConfig } from './store.js'
import { formatReference } from './reference.js'
import { htmlToLine } from './richtext.js'

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
/** 筛选器选项端点。 */
const FILTERS_PATH = '/__filters'
/** 正文图片端点。 */
const IMAGE_PATH = '/__image'

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

        // 面板可能在「还没保存」时就点测试连接，所以这里允许带一份临时补丁：
        // 补丁只用于本次探活，不落盘。不带 body 时等价于测试已保存的配置。
        if (sub === TEST_PATH && req.method === 'POST') {
          return await runTest(res, rowConfig, asPatch(await readBodyQuietly(req)))
        }

        if (sub === STORIES_PATH && req.method === 'GET') return await runStories(res, url, rowConfig)

        if (sub === STORY_PATH && req.method === 'GET') return await runStory(res, url, rowConfig)

        if (sub === FILTERS_PATH && req.method === 'GET') return await runFilters(res, rowConfig)

        if (sub === IMAGE_PATH && req.method === 'GET') return await runImage(res, url, rowConfig)

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

/**
 * 真打一次 TAPD（limit=1），把凭据 / 项目 ID 的问题当场暴露给面板。
 * @param rowConfig 插件行上的 config
 * @param override 面板上尚未保存的值，只在本次探活里覆盖生效配置
 */
async function runTest(res: ServerResponse, rowConfig: StoredConfig, override: StoredConfig = {}): Promise<void> {
  const { resolved } = resolveConfig(rowConfig)
  const merged = applyOverride(resolved, override)
  const configured = Boolean(merged.apiToken || (merged.apiUser && merged.apiPassword))
  if (!configured) {
    sendJson(res, 200, {
      ok: false,
      error: '还没填鉴权：TAPD 免费版填「个人访问令牌」即可（个人设置 → 个人访问令牌）；付费版也可用开放应用 ID + 秘钥',
    })
    return
  }
  if (!merged.workspaceId) {
    sendJson(res, 200, { ok: false, error: '还没填项目 ID' })
    return
  }
  const client = new TapdClient({
    auth: {
      ...(merged.apiUser ? { user: merged.apiUser } : {}),
      ...(merged.apiPassword ? { password: merged.apiPassword } : {}),
      ...(merged.apiToken ? { token: merged.apiToken } : {}),
    },
    defaultWorkspaceId: merged.workspaceId,
    baseUrl: merged.baseUrl,
  })
  try {
    const stories = await client.listStories({ limit: 1 })
    sendJson(res, 200, {
      ok: true,
      workspaceId: merged.workspaceId,
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
  const page = await client.listStoriesPage({
    ...(url.searchParams.get('keyword') ? { name: url.searchParams.get('keyword') as string } : {}),
    ...(url.searchParams.get('status') ? { status: url.searchParams.get('status') as string } : {}),
    ...(url.searchParams.get('owner') ? { owner: url.searchParams.get('owner') as string } : {}),
    ...(url.searchParams.get('iteration') ? { iterationId: url.searchParams.get('iteration') as string } : {}),
    limit: clampInt(url.searchParams.get('limit'), 20, 1, 200),
    page: clampInt(url.searchParams.get('page'), 1, 1, 1000),
  })
  sendJson(res, 200, {
    configured: true,
    workspaceId: view.workspaceId,
    page: page.page,
    limit: page.limit,
    hasMore: page.hasMore,
    ...(page.total === undefined ? {} : { total: page.total }),
    stories: page.stories.map(summarize),
  })
}

/**
 * 筛选器选项：状态表、迭代、成员。
 *
 * 三件事互相独立，任何一项失败都只影响对应的下拉框（例如成员接口没有权限），
 * 所以用 allSettled 而不是 Promise.all——列表本身不该被筛选器拖垮。
 */
async function runFilters(res: ServerResponse, rowConfig: StoredConfig): Promise<void> {
  const view = publicConfig(rowConfig)
  if (!view.configured) {
    sendJson(res, 200, { configured: false, statuses: [], iterations: [], members: [] })
    return
  }
  const client = createClient(rowConfig)
  const [statuses, iterations, members] = await Promise.allSettled([
    client.statusMap(),
    client.listIterations(),
    client.listMembers(),
  ])
  const errors: string[] = []
  const pick = <T>(result: PromiseSettledResult<T>, fallback: T, label: string): T => {
    if (result.status === 'fulfilled') return result.value
    errors.push(`${label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    return fallback
  }
  sendJson(res, 200, {
    configured: true,
    statuses: pick(statuses, [], 'statuses'),
    iterations: pick(iterations, [], 'iterations'),
    members: pick(members, [], 'members'),
    ...(errors.length ? { errors } : {}),
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

/**
 * 正文里的图片。
 *
 * `<img src="/tfl/captures/...">` 指向 www.tapd.cn 的登录态资源，浏览器直连只会跳登录页；
 * 宿主持有令牌，先用 `/files/get_image` 换一个签名地址，再把字节转发回来。
 * 之所以转发字节而不是 302：桌面端页面跑在 `dsh-app://app` 上，
 * 少一层跳转就少一处「换协议之后还认不认」的依赖。
 */
async function runImage(res: ServerResponse, url: URL, rowConfig: StoredConfig): Promise<void> {
  const imagePath = (url.searchParams.get('path') ?? '').trim()
  if (!isImagePath(imagePath)) {
    sendPlaceholder(res, 400, '图片地址不合法')
    return
  }
  try {
    const client = createClient(rowConfig)
    const target = await client.getImageUrl(imagePath)
    const upstream = await fetch(target, { signal: AbortSignal.timeout(20_000) })
    if (!upstream.ok || !upstream.body) {
      upstream.body?.cancel().catch(() => {})
      throw new TapdError(`图片下载地址返回 HTTP ${upstream.status}`)
    }
    // TAPD 的 file.tapd.cn 会回一个残缺的 `Content-Type: image`（没有子类型），
    // 浏览器拿到这种类型不一定肯当图片解码，所以类型不可信时按后缀补一个
    const upstreamType = (upstream.headers.get('content-type') ?? '').trim()
    const contentType = /^image\/[a-z0-9.+-]+$/i.test(upstreamType) ? upstreamType : guessImageType(imagePath)
    const headers = {
      'content-type': contentType,
      // 同一个 path 的图片不会变，缓存住能省调用次数；签名地址本身 300 秒有效
      'cache-control': 'private, max-age=600',
      ...(upstream.headers.get('content-length')
        ? { 'content-length': upstream.headers.get('content-length') as string }
        : {}),
    }
    res.writeHead(200, headers)
    // 转发失败时只能断开：响应头已经发出去了，没法再换成占位图
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
      .on('error', () => res.destroy())
      .pipe(res)
  } catch (error) {
    const message = error instanceof TapdError ? error.message : String((error as Error)?.message ?? error)
    sendPlaceholder(res, 502, message)
  }
}

/** 只放行 TAPD 图床路径，挡掉 `..` 与任何协议前缀。 */
function isImagePath(value: string): boolean {
  if (!value.startsWith('/') || value.includes('..')) return false
  return /^\/[A-Za-z0-9._~/-]+\.(png|jpe?g|gif|bmp|webp)$/i.test(value)
}

/** 按后缀补 content-type；TAPD 自己给的类型不可信时用。 */
function guessImageType(imagePath: string): string {
  const ext = imagePath.slice(imagePath.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

/** 图片取不到时回一张 SVG，面板里看到的是「加载失败」而不是破图标。 */
function sendPlaceholder(res: ServerResponse, status: number, message: string): void {
  const body = placeholderSvg(message)
  res.writeHead(status, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function placeholderSvg(message: string): string {
  const text = message.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch] ?? ch)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120">',
    '<rect x="0.5" y="0.5" width="479" height="119" rx="8" fill="none" stroke="#c9ccd1" stroke-dasharray="6 4"/>',
    '<text x="240" y="56" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13" fill="#8a8f98">图片加载失败</text>',
    `<text x="240" y="78" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" fill="#a8adb5">${text.slice(0, 60)}</text>`,
    '</svg>',
  ].join('')
}

/** 列表行：描述截断，避免一次把几十条正文传进浏览器。 */
function summarize(story: TapdStory): TapdStory & { reference: string; summary: string } {
  // 正文是 HTML，摘要里不能漏标签，先折成单行文本再截断
  const body = htmlToLine(story.description ?? '')
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

/** 用面板上尚未保存的值覆盖生效配置；空字符串表示「不修改」。 */
function applyOverride(resolved: ResolvedConfig, patch: StoredConfig): ResolvedConfig {
  const merged: ResolvedConfig = { ...resolved }
  for (const key of ['apiUser', 'apiPassword', 'apiToken', 'workspaceId', 'baseUrl'] as const) {
    const value = typeof patch[key] === 'string' ? (patch[key] as string).trim() : ''
    if (value) merged[key] = value
  }
  return merged
}

/** 读请求体；空体或坏 JSON 都当作「没有补丁」，不让探活被 body 拖垮。 */
async function readBodyQuietly(req: IncomingMessage): Promise<unknown> {
  try {
    return await readJson(req)
  } catch {
    return {}
  }
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
