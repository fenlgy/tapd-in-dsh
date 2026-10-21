/** 面板可写、可与插件行配置合并的字段。 */
export interface StoredConfig {
    /** TAPD 开放应用 ID / API 账号（Basic Auth） */
    apiUser?: string;
    /** TAPD 开放应用秘钥 / API 密码（Basic Auth） */
    apiPassword?: string;
    /** 个人访问令牌（Bearer），与 apiUser/apiPassword 二选一 */
    apiToken?: string;
    /** 默认项目 ID */
    workspaceId?: string;
    /** 接口地址，私有化部署时改这里 */
    baseUrl?: string;
}
/** 合并后实际使用的配置。 */
export interface ResolvedConfig {
    apiUser?: string;
    apiPassword?: string;
    apiToken?: string;
    workspaceId?: string;
    baseUrl: string;
}
/** 面板读到的配置：不含任何密钥原文，只给存在性标记。 */
export interface PublicConfig {
    workspaceId: string;
    baseUrl: string;
    apiUser: string;
    hasToken: boolean;
    hasBasic: boolean;
    /** 鉴权是否已齐备；未齐备时面板停在配置页 */
    configured: boolean;
    /** 配置来自哪一层，方便排查 */
    source: 'store' | 'config' | 'env' | 'mixed' | 'none';
}
/** DSH 的 home 目录，profile、storages 都在这下面。 */
export declare function dshHome(): string;
/** 面板写入的设置文件。 */
export declare function configFile(): string;
/** 读设置文件；文件缺失或损坏都返回空对象，不让面板起不来。 */
export declare function readStore(): StoredConfig;
/** 合并写入设置文件；字段传空字符串表示清空该字段。 */
export declare function writeStore(patch: StoredConfig): StoredConfig;
/**
 * 按 store → 插件行 config → 环境变量的顺序合并出有效配置。
 * @param row 插件行上的 config（profile 的 cordis.patch.yml）
 */
export declare function resolveConfig(row?: StoredConfig): {
    resolved: ResolvedConfig;
    source: PublicConfig['source'];
};
/** 面板可见的配置视图。 */
export declare function publicConfig(row?: StoredConfig): PublicConfig;
//# sourceMappingURL=store.d.ts.map