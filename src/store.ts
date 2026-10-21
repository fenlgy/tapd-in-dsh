/**
 * 面板与工具共用的配置存储。
 *
 * 三个来源，优先级从高到低：
 *   1. `$DSH_HOME/tapd/config.json` —— 左侧 TAPD 面板「设置」里保存的，用户改一次全局生效；
 *   2. 插件行的 config（profile 的 cordis.patch.yml）；
 *   3. 环境变量 TAPD_API_TOKEN / TAPD_API_USER / TAPD_API_PASSWORD / TAPD_WORKSPACE_ID。
 *
 * 面板只写第 1 层，工具与路由每次按这个顺序合并出「有效配置」，所以保存后无需重启。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 面板可写、可与插件行配置合并的字段。 */
export interface StoredConfig {
  /** TAPD 开放应用 ID / API 账号（Basic Auth） */
  apiUser?: string
  /** TAPD 开放应用秘钥 / API 密码（Basic Auth） */
  apiPassword?: string
  /** 个人访问令牌（Bearer），与 apiUser/apiPassword 二选一 */
  apiToken?: string
  /** 默认项目 ID */
  workspaceId?: string
  /** 接口地址，私有化部署时改这里 */
  baseUrl?: string
}

/** 合并后实际使用的配置。 */
export interface ResolvedConfig {
  apiUser?: string
  apiPassword?: string
  apiToken?: string
  workspaceId?: string
  baseUrl: string
}

/** 面板读到的配置：不含任何密钥原文，只给存在性标记。 */
export interface PublicConfig {
  workspaceId: string
  baseUrl: string
  apiUser: string
  hasToken: boolean
  hasBasic: boolean
  /** 鉴权是否已齐备；未齐备时面板停在配置页 */
  configured: boolean
  /** 配置来自哪一层，方便排查 */
  source: 'store' | 'config' | 'env' | 'mixed' | 'none'
}

/** DSH 的 home 目录，profile、storages 都在这下面。 */
export function dshHome(): string {
  const fromEnv = process.env['DSH_HOME']
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

/** 面板写入的设置文件。 */
export function configFile(): string {
  return path.join(dshHome(), 'tapd', 'config.json')
}

/** 读设置文件；文件缺失或损坏都返回空对象，不让面板起不来。 */
export function readStore(): StoredConfig {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return sanitize(parsed as Record<string, unknown>).patch
  } catch {
    return {}
  }
}

/** 合并写入设置文件；字段传空字符串表示清空该字段。 */
export function writeStore(patch: StoredConfig): StoredConfig {
  const current = readStore()
  const next: StoredConfig = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!isField(key)) continue
    if (value === undefined) continue
    const trimmed = value.trim()
    if (trimmed === '') delete next[key]
    else next[key] = trimmed
  }
  const file = configFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
  return next
}

/**
 * 按 store → 插件行 config → 环境变量的顺序合并出有效配置。
 * @param row 插件行上的 config（profile 的 cordis.patch.yml）
 */
export function resolveConfig(row: StoredConfig = {}): { resolved: ResolvedConfig; source: PublicConfig['source'] } {
  const store = readStore()
  const env = envConfig()
  const pick = (field: keyof StoredConfig): { value?: string; source: PublicConfig['source'] } => {
    const fromStore = text(store[field])
    if (fromStore) return { value: fromStore, source: 'store' }
    const fromRow = text(row[field])
    if (fromRow) return { value: fromRow, source: 'config' }
    const fromEnv = text(env[field])
    if (fromEnv) return { value: fromEnv, source: 'env' }
    return { value: undefined, source: 'none' }
  }

  const apiUser = pick('apiUser')
  const apiPassword = pick('apiPassword')
  const apiToken = pick('apiToken')
  const workspaceId = pick('workspaceId')
  const baseUrl = pick('baseUrl')

  const sources = [apiUser, apiPassword, apiToken, workspaceId, baseUrl]
    .map((item) => item.source)
    .filter((source) => source !== 'none')
  const distinct = new Set(sources)
  const source: PublicConfig['source'] =
    distinct.size === 0 ? 'none' : distinct.size === 1 ? ([...distinct][0] as PublicConfig['source']) : 'mixed'

  return {
    resolved: {
      ...(apiUser.value ? { apiUser: apiUser.value } : {}),
      ...(apiPassword.value ? { apiPassword: apiPassword.value } : {}),
      ...(apiToken.value ? { apiToken: apiToken.value } : {}),
      ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
      baseUrl: baseUrl.value ?? 'https://api.tapd.cn',
    },
    source,
  }
}

/** 面板可见的配置视图。 */
export function publicConfig(row: StoredConfig = {}): PublicConfig {
  const { resolved, source } = resolveConfig(row)
  const hasBasic = Boolean(resolved.apiUser && resolved.apiPassword)
  const hasToken = Boolean(resolved.apiToken)
  return {
    workspaceId: resolved.workspaceId ?? '',
    baseUrl: resolved.baseUrl,
    apiUser: resolved.apiUser ?? '',
    hasToken,
    hasBasic,
    configured: hasBasic || hasToken,
    source,
  }
}

/** 只接受已知字段，顺手把非字符串值挡掉。 */
function sanitize(input: Record<string, unknown>): { patch: StoredConfig } {
  const patch: StoredConfig = {}
  for (const [key, value] of Object.entries(input)) {
    if (!isField(key)) continue
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) patch[key] = trimmed
  }
  return { patch }
}

function isField(key: string): key is keyof StoredConfig {
  return key === 'apiUser' || key === 'apiPassword' || key === 'apiToken' || key === 'workspaceId' || key === 'baseUrl'
}

function envConfig(): StoredConfig {
  return {
    ...(text(process.env['TAPD_API_USER']) ? { apiUser: text(process.env['TAPD_API_USER']) } : {}),
    ...(text(process.env['TAPD_API_PASSWORD']) ? { apiPassword: text(process.env['TAPD_API_PASSWORD']) } : {}),
    ...(text(process.env['TAPD_API_TOKEN']) ? { apiToken: text(process.env['TAPD_API_TOKEN']) } : {}),
    ...(text(process.env['TAPD_WORKSPACE_ID']) ? { workspaceId: text(process.env['TAPD_WORKSPACE_ID']) } : {}),
  }
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
