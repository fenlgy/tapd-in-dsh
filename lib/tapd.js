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
        const params = this.storyQuery(query);
        params.set('fields', STORY_FIELDS);
        params.set('order', 'created desc');
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
        const story = pickStory(envelope.data);
        if (!story)
            throw new TapdError(`TAPD 更新需求 ${patch.id} 返回了空结果。`);
        return story;
    }
    /** 新建需求（POST /stories/add）。需要令牌有 stories::add 权限。 */
    async createStory(input, signal) {
        this.assertConfigured();
        const name = input.name.trim();
        if (!name)
            throw new TapdError('新建需求必须给标题（name）。');
        const body = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(input.workspaceId),
            name,
        });
        if (input.description)
            body.set('description', input.description);
        if (input.owner)
            body.set('owner', input.owner);
        if (input.priority_label)
            body.set('priority', input.priority_label);
        if (input.iteration_id)
            body.set('iteration_id', input.iteration_id);
        if (input.current_user)
            body.set('current_user', input.current_user);
        const envelope = await this.request('/stories/add', { method: 'POST', body, signal });
        const story = pickStory(envelope.data);
        if (!story)
            throw new TapdError('TAPD 新建需求返回了空结果。');
        return story;
    }
    /** 一条需求的评论，按时间正序。 */
    async listComments(query, signal) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(query.workspaceId),
            entry_type: 'stories',
            entry_id: query.storyId,
            limit: String(Math.min(query.limit ?? 50, 200)),
            page: String(query.page ?? 1),
            order: 'created asc',
        });
        const envelope = await this.request(`/comments?${params}`, { signal });
        return (envelope.data ?? []).map((row) => normalizeComment(row.Comment)).filter(isPresent);
    }
    /** 给需求加一条评论（POST /comments/add）。需要令牌有 comments::add 权限。 */
    async addComment(input, signal) {
        this.assertConfigured();
        const description = input.description.trim();
        if (!description)
            throw new TapdError('评论正文不能为空。');
        const body = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(input.workspaceId),
            entry_type: 'stories',
            entry_id: input.storyId,
            description,
        });
        if (input.author)
            body.set('author', input.author);
        const envelope = await this.request('/comments/add', {
            method: 'POST',
            body,
            signal,
        });
        const comment = normalizeComment(envelope.data?.Comment);
        if (!comment)
            throw new TapdError(`TAPD 给需求 ${input.storyId} 加评论返回了空结果。`);
        return comment;
    }
    /**
     * 描述正文里的图片换成可直接下载的临时地址。
     *
     * 正文里的 `<img src="/tfl/captures/...">` 挂在 www.tapd.cn 上，要浏览器登录态才给；
     * Open API 能用令牌换一个签名地址（默认 300 秒有效），面板据此匿名取图。
     * 文档：GET /files/get_image?workspace_id=&image_path=
     */
    async getImageUrl(imagePath, options = {}) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(options.workspaceId),
            image_path: imagePath,
        });
        const envelope = await this.request(`/files/get_image?${params}`, {
            signal: options.signal,
        });
        const url = str(envelope.data?.Attachment?.download_url);
        if (!url)
            throw new TapdError(`TAPD 没有为图片 ${imagePath} 返回下载地址。`);
        return url;
    }
    /** 需求总数，过滤器与列表保持一致，前端才能算「还有没有下一页」。 */
    async countStories(query = {}, signal) {
        this.assertConfigured();
        const params = this.storyQuery(query);
        const envelope = await this.request(`/stories/count?${params}`, { signal });
        const count = Number(envelope.data?.count);
        return Number.isFinite(count) ? count : undefined;
    }
    /** 一页需求 + 总数，面板用。 */
    async listStoriesPage(query = {}, signal) {
        const limit = Math.min(query.limit ?? this.pageSize, 200);
        const page = query.page ?? 1;
        const stories = await this.listStories({ ...query, limit, page }, signal);
        // 总数量不出来不影响列表本身，只是没法显示「共 N 条」
        const total = await this.countStories(query, signal).catch(() => undefined);
        return {
            stories,
            ...(total === undefined ? {} : { total }),
            page,
            limit,
            hasMore: stories.length >= limit && (total === undefined || page * limit < total),
        };
    }
    /** 项目迭代列表，面板的下拉框用。 */
    async listIterations(options = {}) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(options.workspaceId),
            limit: String(Math.min(options.limit ?? 50, 200)),
            order: 'created desc',
        });
        const envelope = await this.request(`/iterations?${params}`, {
            signal: options.signal,
        });
        return (envelope.data ?? [])
            .map((row) => {
            const raw = row.Iteration;
            const id = str(raw?.id);
            if (!id)
                return undefined;
            return {
                id,
                ...(str(raw?.name) ? { name: str(raw?.name) } : {}),
                ...(str(raw?.status) ? { status: str(raw?.status) } : {}),
                ...(str(raw?.startdate) ? { startdate: str(raw?.startdate) } : {}),
                ...(str(raw?.enddate) ? { enddate: str(raw?.enddate) } : {}),
            };
        })
            .filter(isPresent);
    }
    /** 项目成员列表，面板「处理人」筛选与工具提示用。 */
    async listMembers(options = {}) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(options.workspaceId),
            limit: String(Math.min(options.limit ?? 100, 200)),
        });
        const envelope = await this.request(`/workspaces/users?${params}`, {
            signal: options.signal,
        });
        return (envelope.data ?? [])
            .map((row) => {
            const user = str(row.UserWorkspace?.user);
            if (!user)
                return undefined;
            return { user, ...(str(row.UserWorkspace?.name) ? { name: str(row.UserWorkspace?.name) } : {}) };
        })
            .filter(isPresent);
    }
    /** 需求状态表（状态码 → 中文名），面板的状态下拉框用。 */
    async statusMap(options = {}) {
        this.assertConfigured();
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(options.workspaceId),
            system: 'story',
        });
        const envelope = await this.request(`/workflows/status_map?${params}`, {
            signal: options.signal,
        });
        const data = envelope.data ?? {};
        return Object.entries(data)
            .filter(([key, name]) => Boolean(key) && typeof name === 'string')
            .map(([key, name]) => ({ key, name }));
    }
    /** 列表与计数共用的查询串，保证两边过滤条件一致。 */
    storyQuery(query) {
        const params = new URLSearchParams({
            workspace_id: this.resolveWorkspaceId(query.workspaceId),
            limit: String(Math.min(query.limit ?? this.pageSize, 200)),
            page: String(query.page ?? 1),
        });
        if (query.name)
            params.set('name', query.name);
        if (query.owner)
            params.set('owner', query.owner);
        if (query.status)
            params.set('status', query.status);
        if (query.iterationId)
            params.set('iteration_id', query.iterationId);
        return params;
    }
    assertConfigured() {
        if (!this.configured) {
            throw new TapdError('未配置 TAPD 鉴权。填 apiToken（个人访问令牌，免费版也可用），或 apiUser + apiPassword（开放应用 ID / 秘钥）。');
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
            // TAPD 在 4xx 时仍会返回 { status, info }，info 才是真正的原因
            // （例如 422 "The access token provided is invalid"），必须透传给用户。
            const info = await readFailureInfo(response);
            throw new TapdError(`TAPD 返回 HTTP ${response.status}${info ? `：${info}` : ''}${explainStatus(response.status, info)}`, response.status, info);
        }
        const payload = (await response.json());
        if (payload.status !== 1) {
            throw new TapdError(`TAPD 接口报错：${payload.info ?? '未知原因'}`, response.status, payload.info);
        }
        return payload;
    }
}
/** 更新 / 新建接口的返回可能是单个对象，也可能是长度为 1 的数组。 */
function pickStory(data) {
    if (!data)
        return undefined;
    const raw = Array.isArray(data) ? data[0]?.Story : data.Story;
    return normalizeStory(raw);
}
function normalizeComment(raw) {
    if (!raw)
        return undefined;
    const id = str(raw.id);
    if (!id)
        return undefined;
    return {
        id,
        ...(str(raw.entry_id) ? { entry_id: str(raw.entry_id) } : {}),
        ...(str(raw.title) ? { title: str(raw.title) } : {}),
        ...(str(raw.description) ? { description: str(raw.description) } : {}),
        ...(str(raw.author) ? { author: str(raw.author) } : {}),
        ...(str(raw.created) ? { created: str(raw.created) } : {}),
    };
}
function isPresent(value) {
    return value !== undefined;
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
/**
 * 从非 2xx 响应里取出 TAPD 的 info。
 * 取不到就返回 undefined，不要因为解析失败盖掉真正的 HTTP 错误。
 */
async function readFailureInfo(response) {
    try {
        const body = await response.text();
        if (!body)
            return undefined;
        const parsed = JSON.parse(body);
        if (typeof parsed.info === 'string' && parsed.info.trim())
            return parsed.info.trim();
        if (typeof parsed.error === 'string' && parsed.error.trim())
            return parsed.error.trim();
        return body.slice(0, 200);
    }
    catch {
        return undefined;
    }
}
/**
 * 针对常见状态码补一句「该去哪儿改」，避免用户对着 HTTP 码猜。
 *
 * TAPD 把好几种完全不同的原因都塞进 403，必须按 info 细分：
 * 同样的 403，可能是跨企业填错了项目 ID，也可能是项目成员权限不足，
 * 还可能是企业根本没开通 API 账号——处理方式完全不同。
 */
function explainStatus(status, info) {
    const text = info ?? '';
    if (/company does not match/i.test(text)) {
        return '（令牌所属企业与该项目不匹配：个人令牌只能访问自己企业的项目，核对项目 ID 是不是从别的企业复制来的）';
    }
    if (/not allowed to access project/i.test(text)) {
        return '（令牌无权访问该项目：核对项目 ID，或在 TAPD 项目成员里把自己加进去）';
    }
    if (/don't have permission to access this company|no permission to access this company/i.test(text)) {
        return '（个人令牌没有公司级读权限：这是正常的，个人令牌只能查项目内的需求，不需要拉公司项目列表）';
    }
    // 写操作最容易撞上的就是权限：令牌能读不一定能写，必须把具体权限点报出来
    const permission = /doesn'?t have permission ([\w:]+)/i.exec(text);
    if (permission?.[1]) {
        return `（当前令牌没有「${permission[1]}」权限：去 TAPD 项目 → 项目设置 → 成员与权限，给这个账号开对应权限，或换一个有写权限的 API 账号）`;
    }
    const hints = {
        401: '（没带上鉴权信息，确认填了个人访问令牌或 API 账号）',
        403: '（凭据有效但无权访问：可能是企业未开通 API 账号，或令牌范围被管理员限制）',
        404: '（接口或项目不存在，核对项目 ID）',
        422: '（个人访问令牌无效或已过期，去 TAPD「个人设置」重新生成）',
        429: '（调用次数超限，免费企业为 2000 次/天）',
    };
    return hints[status] ?? '';
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