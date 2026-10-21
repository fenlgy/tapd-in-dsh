/**
 * tapd-in-dsh —— DeepSeek Harness 插件宿主半区。
 *
 * 三件事：
 * 1. 注册 tapd_* 工具，让模型能查询 / 更新 TAPD 需求；
 * 2. 监听 agent/pre-step，把会话里的 `@tapd:story:<id>` 引用展开成需求正文；
 * 3. 在宿主 web server 上挂 `/tapd` 路由，给左侧「TAPD」面板提供配置读写与需求列表。
 *
 * 配置优先级见 store.ts：面板保存的 `$DSH_HOME/tapd/config.json` > 插件行 config > 环境变量。
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { TapdStory } from './tapd.js';
export declare const name = "tapd-in-dsh";
/** 只依赖工具注册表；事件监听走 cordis 核心，web server 用可选注入。 */
export declare const inject: string[];
export interface Config {
    /** TAPD 开放应用 ID / API 账号（Basic Auth） */
    apiUser?: string;
    /** TAPD 开放应用秘钥 / API 密码（Basic Auth） */
    apiPassword?: string;
    /** TAPD 个人访问令牌（Bearer），与 apiUser/apiPassword 二选一 */
    apiToken?: string;
    /** 默认项目 ID，单项目使用时只配这里即可 */
    workspaceId?: string;
    /** 接口地址，私有化部署时改这里 */
    baseUrl: string;
    /** 单次请求超时（毫秒） */
    timeoutMs: number;
    /** 是否在发送前展开 @tapd 引用 */
    injectReference: boolean;
    /** 单轮最多展开几个引用，防止一次塞爆上下文 */
    maxReferences: number;
    /** 单条需求描述注入上限（字符） */
    maxBodyChars: number;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
/** 供后续面板复用：把需求渲染成 Markdown 摘要。 */
export declare function toMarkdown(story: TapdStory): string;
//# sourceMappingURL=index.d.ts.map