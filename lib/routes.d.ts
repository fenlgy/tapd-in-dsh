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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TapdClient } from './tapd.js';
import type { StoredConfig } from './store.js';
/** 挂在宿主上的路由前缀。 */
export declare const ROUTE_PATH = "/tapd";
/** 宿主 web server 的最小接口，避免把 dsh-host-webserver 变成硬依赖。 */
interface WebServerLike {
    register(route: {
        kind: 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => unknown;
    }): () => void;
}
/**
 * 把路由注册到宿主 web server。
 * @param webServer 宿主的 web server 服务
 * @param rowConfig 插件行上的 config，作为 store 与环境变量之间的兜底
 */
export declare function registerRoutes(webServer: WebServerLike, rowConfig: StoredConfig): () => void;
/** 用当前有效配置构造一个 TAPD 客户端。 */
export declare function createClient(rowConfig?: StoredConfig, timeoutMs?: number): TapdClient;
export {};
//# sourceMappingURL=routes.d.ts.map