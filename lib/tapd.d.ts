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
export declare class TapdError extends Error {
    readonly status?: number | undefined;
    readonly info?: string | undefined;
    constructor(message: string, status?: number | undefined, info?: string | undefined);
}
/** 鉴权材料：二选一，Basic 优先。 */
export interface TapdAuth {
    /** API 账号 / 开放应用 ID */
    readonly user?: string;
    /** API 密码 / 开放应用秘钥 */
    readonly password?: string;
    /** 个人访问令牌（Bearer） */
    readonly token?: string;
}
export interface TapdClientOptions {
    readonly auth: TapdAuth;
    /** 默认项目 ID，单项目使用时可以只配这一处 */
    readonly defaultWorkspaceId?: string;
    readonly baseUrl?: string;
    readonly timeoutMs?: number;
    /** 单页条数，TAPD 上限 200 */
    readonly pageSize?: number;
}
/** 需求字段裁剪后的稳定形状，避免把 custom_field_1..200 全量灌进上下文。 */
export interface TapdStory {
    readonly id: string;
    readonly workspace_id?: string;
    readonly name?: string;
    readonly status?: string;
    readonly owner?: string;
    readonly creator?: string;
    readonly created?: string;
    readonly modified?: string;
    readonly priority_label?: string;
    readonly iteration_id?: string;
    readonly type?: string;
    readonly begin?: string;
    readonly due?: string;
    readonly description?: string;
    readonly url: string;
}
export interface ListStoriesQuery {
    readonly workspaceId?: string;
    readonly name?: string;
    readonly owner?: string;
    readonly status?: string;
    readonly iterationId?: string;
    readonly limit?: number;
    readonly page?: number;
}
export interface UpdateStoryPatch {
    readonly workspaceId?: string;
    readonly id: string;
    readonly status?: string;
    readonly owner?: string;
    readonly priority_label?: string;
    readonly current_user?: string;
}
/** 新建需求时能带的字段（TAPD POST /stories/add）。 */
export interface CreateStoryInput {
    readonly workspaceId?: string;
    /** 标题，必填 */
    readonly name: string;
    readonly description?: string;
    readonly owner?: string;
    readonly priority_label?: string;
    readonly iteration_id?: string;
    readonly current_user?: string;
}
/** 需求评论（TAPD /comments）。 */
export interface TapdComment {
    readonly id: string;
    readonly entry_id?: string;
    readonly title?: string;
    readonly description?: string;
    readonly author?: string;
    readonly created?: string;
}
export interface AddCommentInput {
    readonly workspaceId?: string;
    /** 需求 ID */
    readonly storyId: string;
    /** 评论正文，支持 HTML / 纯文本 */
    readonly description: string;
    /** 评论人 TAPD 用户名；不填由 TAPD 按凭据推断 */
    readonly author?: string;
}
export interface ListCommentsQuery {
    readonly workspaceId?: string;
    readonly storyId: string;
    readonly limit?: number;
    readonly page?: number;
}
/** 迭代（TAPD /iterations）。 */
export interface TapdIteration {
    readonly id: string;
    readonly name?: string;
    readonly status?: string;
    readonly startdate?: string;
    readonly enddate?: string;
}
/** 项目成员（TAPD /workspaces/users），只留过滤器要用的两个字段。 */
export interface TapdMember {
    readonly user: string;
    readonly name?: string;
}
/** 需求列表的一页结果，带总数供面板显示「共 N 条」。 */
export interface StoryPage {
    readonly stories: TapdStory[];
    readonly total?: number;
    readonly page: number;
    readonly limit: number;
    readonly hasMore: boolean;
}
export declare class TapdClient {
    private readonly options;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly pageSize;
    constructor(options: TapdClientOptions);
    /** 是否已具备可用鉴权，用于工具层给出可读的配置提示。 */
    get configured(): boolean;
    get defaultWorkspaceId(): string | undefined;
    /** 解析项目 ID：显式传入优先，其次用配置里的默认项目。 */
    resolveWorkspaceId(explicit?: string): string;
    listStories(query?: ListStoriesQuery, signal?: AbortSignal): Promise<TapdStory[]>;
    getStory(id: string, options?: {
        workspaceId?: string;
        signal?: AbortSignal;
    }): Promise<TapdStory>;
    updateStory(patch: UpdateStoryPatch, signal?: AbortSignal): Promise<TapdStory>;
    /** 新建需求（POST /stories/add）。需要令牌有 stories::add 权限。 */
    createStory(input: CreateStoryInput, signal?: AbortSignal): Promise<TapdStory>;
    /** 一条需求的评论，按时间正序。 */
    listComments(query: ListCommentsQuery, signal?: AbortSignal): Promise<TapdComment[]>;
    /** 给需求加一条评论（POST /comments/add）。需要令牌有 comments::add 权限。 */
    addComment(input: AddCommentInput, signal?: AbortSignal): Promise<TapdComment>;
    /**
     * 描述正文里的图片换成可直接下载的临时地址。
     *
     * 正文里的 `<img src="/tfl/captures/...">` 挂在 www.tapd.cn 上，要浏览器登录态才给；
     * Open API 能用令牌换一个签名地址（默认 300 秒有效），面板据此匿名取图。
     * 文档：GET /files/get_image?workspace_id=&image_path=
     */
    getImageUrl(imagePath: string, options?: {
        workspaceId?: string;
        signal?: AbortSignal;
    }): Promise<string>;
    /** 需求总数，过滤器与列表保持一致，前端才能算「还有没有下一页」。 */
    countStories(query?: ListStoriesQuery, signal?: AbortSignal): Promise<number | undefined>;
    /** 一页需求 + 总数，面板用。 */
    listStoriesPage(query?: ListStoriesQuery, signal?: AbortSignal): Promise<StoryPage>;
    /** 项目迭代列表，面板的下拉框用。 */
    listIterations(options?: {
        workspaceId?: string;
        limit?: number;
        signal?: AbortSignal;
    }): Promise<TapdIteration[]>;
    /** 项目成员列表，面板「处理人」筛选与工具提示用。 */
    listMembers(options?: {
        workspaceId?: string;
        limit?: number;
        signal?: AbortSignal;
    }): Promise<TapdMember[]>;
    /** 需求状态表（状态码 → 中文名），面板的状态下拉框用。 */
    statusMap(options?: {
        workspaceId?: string;
        signal?: AbortSignal;
    }): Promise<Array<{
        key: string;
        name: string;
    }>>;
    /** 列表与计数共用的查询串，保证两边过滤条件一致。 */
    private storyQuery;
    private assertConfigured;
    private request;
}
//# sourceMappingURL=tapd.d.ts.map