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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
/** DSH 的 home 目录，profile、storages 都在这下面。 */
export function dshHome() {
    const fromEnv = process.env['DSH_HOME'];
    if (fromEnv && fromEnv.trim())
        return fromEnv.trim();
    return path.join(os.homedir(), '.dsh');
}
/** 面板写入的设置文件。 */
export function configFile() {
    return path.join(dshHome(), 'tapd', 'config.json');
}
/** 读设置文件；文件缺失或损坏都返回空对象，不让面板起不来。 */
export function readStore() {
    try {
        const raw = fs.readFileSync(configFile(), 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return {};
        return sanitize(parsed).patch;
    }
    catch {
        return {};
    }
}
/** 合并写入设置文件；字段传空字符串表示清空该字段。 */
export function writeStore(patch) {
    const current = readStore();
    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (!isField(key))
            continue;
        if (value === undefined)
            continue;
        const trimmed = value.trim();
        if (trimmed === '')
            delete next[key];
        else
            next[key] = trimmed;
    }
    const file = configFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    return next;
}
/**
 * 按 store → 插件行 config → 环境变量的顺序合并出有效配置。
 * @param row 插件行上的 config（profile 的 cordis.patch.yml）
 */
export function resolveConfig(row = {}) {
    const store = readStore();
    const env = envConfig();
    const pick = (field) => {
        const fromStore = text(store[field]);
        if (fromStore)
            return { value: fromStore, source: 'store' };
        const fromRow = text(row[field]);
        if (fromRow)
            return { value: fromRow, source: 'config' };
        const fromEnv = text(env[field]);
        if (fromEnv)
            return { value: fromEnv, source: 'env' };
        return { value: undefined, source: 'none' };
    };
    const apiUser = pick('apiUser');
    const apiPassword = pick('apiPassword');
    const apiToken = pick('apiToken');
    const workspaceId = pick('workspaceId');
    const baseUrl = pick('baseUrl');
    const sources = [apiUser, apiPassword, apiToken, workspaceId, baseUrl]
        .map((item) => item.source)
        .filter((source) => source !== 'none');
    const distinct = new Set(sources);
    const source = distinct.size === 0 ? 'none' : distinct.size === 1 ? [...distinct][0] : 'mixed';
    return {
        resolved: {
            ...(apiUser.value ? { apiUser: apiUser.value } : {}),
            ...(apiPassword.value ? { apiPassword: apiPassword.value } : {}),
            ...(apiToken.value ? { apiToken: apiToken.value } : {}),
            ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
            baseUrl: baseUrl.value ?? 'https://api.tapd.cn',
        },
        source,
    };
}
/** 面板可见的配置视图。 */
export function publicConfig(row = {}) {
    const { resolved, source } = resolveConfig(row);
    const hasBasic = Boolean(resolved.apiUser && resolved.apiPassword);
    const hasToken = Boolean(resolved.apiToken);
    return {
        workspaceId: resolved.workspaceId ?? '',
        baseUrl: resolved.baseUrl,
        apiUser: resolved.apiUser ?? '',
        hasToken,
        hasBasic,
        configured: hasBasic || hasToken,
        source,
    };
}
/** 只接受已知字段，顺手把非字符串值挡掉。 */
function sanitize(input) {
    const patch = {};
    for (const [key, value] of Object.entries(input)) {
        if (!isField(key))
            continue;
        if (typeof value !== 'string')
            continue;
        const trimmed = value.trim();
        if (trimmed)
            patch[key] = trimmed;
    }
    return { patch };
}
function isField(key) {
    return key === 'apiUser' || key === 'apiPassword' || key === 'apiToken' || key === 'workspaceId' || key === 'baseUrl';
}
function envConfig() {
    return {
        ...(text(process.env['TAPD_API_USER']) ? { apiUser: text(process.env['TAPD_API_USER']) } : {}),
        ...(text(process.env['TAPD_API_PASSWORD']) ? { apiPassword: text(process.env['TAPD_API_PASSWORD']) } : {}),
        ...(text(process.env['TAPD_API_TOKEN']) ? { apiToken: text(process.env['TAPD_API_TOKEN']) } : {}),
        ...(text(process.env['TAPD_WORKSPACE_ID']) ? { workspaceId: text(process.env['TAPD_WORKSPACE_ID']) } : {}),
    };
}
function text(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
//# sourceMappingURL=store.js.map