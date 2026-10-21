/**
 * TAPD 开放平台 REST 客户端（需求 / story 维度）。
 *
 * 依据 TAPD 开放平台文档：
 * - 查询需求：GET  https://api.tapd.cn/stories?workspace_id=...&limit=...&page=...
 *   默认返回 30 条，limit 最大 200。
 * - 更新需求：POST https://api.tapd.cn/stories，必填 id + workspace_id。
 * - 鉴权：Basic Auth（API 账号:密码 / 应用 ID:应用秘钥），或 Bearer 个人访问令牌。
 * - 返回结构：{ status: 1, data: [...], info: 'success' }，status !== 1 视为失败。
 */

/** 插件调用 TAPD 失败时抛出的错误，带上 HTTP 状态与 TAPD 的 info。 */
export class TapdError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly info?: string,
  ) {
    super(message)
    this.name = 'TapdError'
  }
}

/** 鉴权材料：二选一，Basic 优先。 */
export interface TapdAuth {
  /** API 账号 / 开放应用 ID */
  readonly user?: string
  /** API 密码 / 开放应用秘钥 */
  readonly password?: string
  /** 个人访问令牌（Bearer） */
  readonly token?: string
}

export interface TapdClientOptions {
  readonly auth: TapdAuth
  /** 默认项目 ID，单项目使用时可以只配这一处 */
  readonly defaultWorkspaceId?: string
  readonly baseUrl?: string
  readonly timeoutMs?: number
  /** 单页条数，TAPD 上限 200 */
  readonly pageSize?: number
}

/** 需求字段裁剪后的稳定形状，避免把 custom_field_1..200 全量灌进上下文。 */
export interface TapdStory {
  readonly id: string
  readonly workspace_id?: string
  readonly name?: string
  readonly status?: string
  readonly owner?: string
  readonly creator?: string
  readonly created?: string
  readonly modified?: string
  readonly priority_label?: string
  readonly iteration_id?: string
  readonly type?: string
  readonly begin?: string
  readonly due?: string
  readonly description?: string
  readonly url: string
}

export interface ListStoriesQuery {
  readonly workspaceId?: string
  readonly name?: string
  readonly owner?: string
  readonly status?: string
  readonly iterationId?: string
  readonly limit?: number
  readonly page?: number
}

export interface UpdateStoryPatch {
  readonly workspaceId?: string
  readonly id: string
  readonly status?: string
  readonly owner?: string
  readonly priority_label?: string
  readonly current_user?: string
}

const STORY_FIELDS = [
  'id',
  'workspace_id',
  'name',
  'status',
  'owner',
  'creator',
  'created',
  'modified',
  'priority_label',
  'iteration_id',
  'type',
  'begin',
  'due',
  'description',
].join(',')

interface TapdEnvelope<T> {
  readonly status?: number
  readonly data?: T
  readonly info?: string
}

export class TapdClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly pageSize: number
  constructor(private readonly options: TapdClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.tapd.cn').replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.pageSize = Math.min(options.pageSize ?? 30, 200)
  }

  /** 是否已具备可用鉴权，用于工具层给出可读的配置提示。 */
  get configured(): boolean {
    const { user, password, token } = this.options.auth
    return Boolean((user && password) || token)
  }

  get defaultWorkspaceId(): string | undefined {
    return this.options.defaultWorkspaceId
  }

  /** 解析项目 ID：显式传入优先，其次用配置里的默认项目。 */
  resolveWorkspaceId(explicit?: string): string {
    const workspaceId = explicit ?? this.options.defaultWorkspaceId
    if (!workspaceId) {
      throw new TapdError('缺少 workspace_id：调用时传入 workspace_id，或在插件配置里设置 workspaceId。')
    }
    return workspaceId
  }

  async listStories(query: ListStoriesQuery = {}, signal?: AbortSignal): Promise<TapdStory[]> {
    this.assertConfigured()
    const params = new URLSearchParams({
      workspace_id: this.resolveWorkspaceId(query.workspaceId),
      limit: String(Math.min(query.limit ?? this.pageSize, 200)),
      page: String(query.page ?? 1),
      fields: STORY_FIELDS,
      order: 'created desc',
    })
    if (query.name) params.set('name', query.name)
    if (query.owner) params.set('owner', query.owner)
    if (query.status) params.set('status', query.status)
    if (query.iterationId) params.set('iteration_id', query.iterationId)

    const envelope = await this.request<TapdStoryEnvelope[]>(`/stories?${params}`, { signal })
    return (envelope.data ?? []).map((row) => normalizeStory(row.Story)).filter(isStory)
  }

  async getStory(id: string, options: { workspaceId?: string; signal?: AbortSignal } = {}): Promise<TapdStory> {
    this.assertConfigured()
    const params = new URLSearchParams({
      workspace_id: this.resolveWorkspaceId(options.workspaceId),
      id,
      fields: STORY_FIELDS,
    })
    const envelope = await this.request<TapdStoryEnvelope[]>(`/stories?${params}`, { signal: options.signal })
    const story = (envelope.data ?? []).map((row) => normalizeStory(row.Story)).find(Boolean)
    if (!story) throw new TapdError(`TAPD 上找不到需求 ${id}（项目 ${params.get('workspace_id')}）。`)
    return story
  }

  async updateStory(patch: UpdateStoryPatch, signal?: AbortSignal): Promise<TapdStory> {
    this.assertConfigured()
    const body = new URLSearchParams({
      id: patch.id,
      workspace_id: this.resolveWorkspaceId(patch.workspaceId),
    })
    if (patch.status) body.set('status', patch.status)
    if (patch.owner) body.set('owner', patch.owner)
    if (patch.priority_label) body.set('priority_label', patch.priority_label)
    if (patch.current_user) body.set('current_user', patch.current_user)

    const envelope = await this.request<TapdStoryEnvelope>('/stories', { method: 'POST', body, signal })
    const raw = Array.isArray(envelope.data) ? envelope.data[0]?.Story : envelope.data?.Story
    const story = normalizeStory(raw)
    if (!story) throw new TapdError(`TAPD 更新需求 ${patch.id} 返回了空结果。`)
    return story
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new TapdError(
        '未配置 TAPD 鉴权。请在插件配置里填 apiUser + apiPassword（开放应用 ID / 秘钥），或填 apiToken（个人访问令牌）。',
      )
    }
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: URLSearchParams; signal?: AbortSignal } = {},
  ): Promise<TapdEnvelope<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const { user, password, token } = this.options.auth
    if (user && password) {
      headers.Authorization = `Basic ${base64(`${user}:${password}`)}`
    } else if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    if (init.body) headers['Content-Type'] = 'application/x-www-form-urlencoded'

    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body?.toString(),
        signal,
      })
    } catch (error) {
      throw new TapdError(`请求 TAPD 失败：${describeError(error)}`)
    }

    if (!response.ok) {
      throw new TapdError(`TAPD 返回 HTTP ${response.status}`, response.status)
    }

    const payload = (await response.json()) as TapdEnvelope<T>
    if (payload.status !== 1) {
      throw new TapdError(`TAPD 接口报错：${payload.info ?? '未知原因'}`, response.status, payload.info)
    }
    return payload
  }
}

interface TapdStoryEnvelope {
  readonly Story?: Record<string, unknown>
}

function normalizeStory(raw: Record<string, unknown> | undefined): TapdStory | undefined {
  if (!raw) return undefined
  const id = str(raw.id)
  if (!id) return undefined
  const workspaceId = str(raw.workspace_id)
  return {
    id,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(str(raw.name) ? { name: str(raw.name) } : {}),
    ...(str(raw.status) ? { status: str(raw.status) } : {}),
    ...(str(raw.owner) ? { owner: str(raw.owner) } : {}),
    ...(str(raw.creator) ? { creator: str(raw.creator) } : {}),
    ...(str(raw.created) ? { created: str(raw.created) } : {}),
    ...(str(raw.modified) ? { modified: str(raw.modified) } : {}),
    ...(str(raw.priority_label) ? { priority_label: str(raw.priority_label) } : {}),
    ...(str(raw.iteration_id) ? { iteration_id: str(raw.iteration_id) } : {}),
    ...(str(raw.type) ? { type: str(raw.type) } : {}),
    ...(str(raw.begin) ? { begin: str(raw.begin) } : {}),
    ...(str(raw.due) ? { due: str(raw.due) } : {}),
    ...(str(raw.description) ? { description: str(raw.description) } : {}),
    // TAPD 需求详情页的稳定跳转地址
    url: `https://www.tapd.cn/${workspaceId ?? '0'}/prong/stories/view/${id}`,
  }
}

function isStory(value: TapdStory | undefined): value is TapdStory {
  return Boolean(value)
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function base64(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64')
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '请求超时'
    if (error.name === 'AbortError') return '请求被取消'
    return error.message
  }
  return String(error)
}
