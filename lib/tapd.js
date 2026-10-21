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
    status;
    info;
    constructor(message, status, info) {
        super(message);
        this.status = status;
        this.info = info;
        this.name = 'TapdError';
    }
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
].join(',');
export class TapdClient {
    options;
    baseUrl;
    timeoutMs;
    pageSize;
    constructor(options) {
        this.options = options;
        this.baseUrl = (options.baseUrl ?? 'https://api.tapd.cn').replace(/\/+$/, '');
        this.timeoutMs = options.timeoutMs ?? 15_000;
        this.pageSize = Math.min(options.pageSize ?? 30, 200);
    }
    /** 是否已具备可用鉴权，用于工具层给出可读的配置提示。 */
    get configured() {
        const { user, password, token } = this.options.auth;
        return Boolean((user && password) || token);
    }
    get defaultWorkspaceId() {
        return this.options.defaultWorkspaceId;
    }
    /** 解析项目 ID：显式传入优先，其次用配置里的默认项目。 */
    resolveWorkspaceId(explicit) {
        const workspaceId = explicit ?? this.options.defaultWorkspaceId;
        if (!workspaceId) {
            throw new TapdError('缺少 workspace_id：调用时传入 workspace_id，或在插件配置里设置 workspaceId。');
        }
        return workspaceId;
    }
    async listStories(query = {}, signal) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(query.workspaceId),
            limit: String(Math.min(query.limit ?? this.pageSize, 200)),
            page: String(query.page ?? 1),
            fields: STORY_FIELDS,
            order: 'created desc',
        });
        if (query.name)
            params.set('name', query.name);
        if (query.owner)
            params.set('owner', query.owner);
        if (query.status)
            params.set('status', query.status);
        if (query.iterationId)
            params.set('iteration_id', query.iterationId);
        const envelope = await this.request(`/stories?${params}`, { signal });
        return (envelope.data ?? []).map((row) => normalizeStory(row.Story)).filter(isStory);
    }
    async getStory(id, options = {}) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(options.workspaceId),
            id,
            fields: STORY_FIELDS,
        });
        const envelope = await this.request(`/stories?${params}`, { signal: options.signal });
        const story = (envelope.data ?? []).map((row) => normalizeStory(row.Story)).find(Boolean);
        if (!story)
            throw new TapdError(`TAPD 上找不到需求 ${id}（项目 ${params.get('workspace_id')}）。`);
        return story;
    }
    async updateStory(patch, signal) {
        this.assertConfigured();
        const body = new URLSearchParams({
            id: patch.id,
            workspace_id: this.resolveWorkspaceId(patch.workspaceId),
        });
        if (patch.status)
            body.set('status', patch.status);
        if (patch.owner)
            body.set('owner', patch.owner);
        if (patch.priority_label)
            body.set('priority_label', patch.priority_label);
        if (patch.current_user)
            body.set('current_user', patch.current_user);
        const envelope = await this.request('/stories', { method: 'POST', body, signal });
        const raw = Array.isArray(envelope.data) ? envelope.data[0]?.Story : envelope.data?.Story;
        const story = normalizeStory(raw);
        if (!story)
            throw new TapdError(`TAPD 更新需求 ${patch.id} 返回了空结果。`);
        return story;
    }
    assertConfigured() {
        if (!this.configured) {
            throw new TapdError('未配置 TAPD 鉴权。请在插件配置里填 apiUser + apiPassword（开放应用 ID / 秘钥），或填 apiToken（个人访问令牌）。');
        }
    }
    async request(path, init = {}) {
        const headers = { Accept: 'application/json' };
        const { user, password, token } = this.options.auth;
        if (user && password) {
            headers.Authorization = `Basic ${base64(`${user}:${password}`)}`;
        }
        else if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (init.body)
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method: init.method ?? 'GET',
                headers,
                body: init.body?.toString(),
                signal,
            });
        }
        catch (error) {
            throw new TapdError(`请求 TAPD 失败：${describeError(error)}`);
        }
        if (!response.ok) {
            throw new TapdError(`TAPD 返回 HTTP ${response.status}`, response.status);
        }
        const payload = (await response.json());
        if (payload.status !== 1) {
            throw new TapdError(`TAPD 接口报错：${payload.info ?? '未知原因'}`, response.status, payload.info);
        }
        return payload;
    }
}
function normalizeStory(raw) {
    if (!raw)
        return undefined;
    const id = str(raw.id);
    if (!id)
        return undefined;
    const workspaceId = str(raw.workspace_id);
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
    };
}
function isStory(value) {
    return Boolean(value);
}
function str(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function base64(input) {
    return Buffer.from(input, 'utf8').toString('base64');
}
function describeError(error) {
    if (error instanceof Error) {
        if (error.name === 'TimeoutError')
            return '请求超时';
        if (error.name === 'AbortError')
            return '请求被取消';
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=tapd.js.map