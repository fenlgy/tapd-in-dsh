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
    private assertConfigured;
    private request;
}
//# sourceMappingURL=tapd.d.ts.map