import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { collectReferences, formatReference, renderReferenceFailure, renderStoryContext } from './reference.js';
import { TapdError } from './tapd.js';
import { createClient, registerRoutes } from './routes.js';
import { publicConfig } from './store.js';
export const name = 'tapd-in-dsh';
/** 只依赖工具注册表；事件监听走 cordis 核心，web server 用可选注入。 */
export const inject = ['tools'];
export const Config = Schema.object({
    apiUser: Schema.string().description('TAPD 开放应用 ID / API 账号'),
    apiPassword: Schema.string().role('secret').description('TAPD 开放应用秘钥 / API 密码'),
    apiToken: Schema.string().role('secret').description('TAPD 个人访问令牌（Bearer）'),
    workspaceId: Schema.string().description('默认 TAPD 项目 ID'),
    baseUrl: Schema.string().default('https://api.tapd.cn').description('TAPD 接口地址'),
    timeoutMs: Schema.number().default(15000).description('单次请求超时（毫秒）'),
    injectReference: Schema.boolean().default(true).description('发送前是否展开 @tapd:story:<id> 引用'),
    maxReferences: Schema.number().default(5).description('单轮最多展开的引用条数'),
    maxBodyChars: Schema.number().default(8000).description('单条需求描述注入上限（字符）'),
});
const jsonOutput = {
    schema: { type: 'json' },
    render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
};
export function apply(ctx, config) {
    const rowConfig = {
        ...(config.apiUser ? { apiUser: config.apiUser } : {}),
        ...(config.apiPassword ? { apiPassword: config.apiPassword } : {}),
        ...(config.apiToken ? { apiToken: config.apiToken } : {}),
        ...(config.workspaceId ? { workspaceId: config.workspaceId } : {}),
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    };
    /** 每次调用现取有效配置，所以在面板里保存后立刻生效，不用重启。 */
    const getClient = () => createClient(rowConfig, config.timeoutMs);
    registerTools(ctx, getClient, config);
    if (config.injectReference)
        registerReferenceInjection(ctx, getClient, config);
    registerPanelRoutes(ctx, rowConfig);
}
/**
 * 把面板用的 `/tapd` 路由挂到宿主 web server 上。
 *
 * 用可选注入：没有 webServer 的部署（例如纯 headless）里插件照样提供工具与引用注入，
 * 只是左侧面板取不到数据。
 */
function registerPanelRoutes(ctx, rowConfig) {
    const injector = ctx.inject;
    if (typeof injector !== 'function')
        return;
    injector.call(ctx, ['webServer'], (webCtx) => {
        const server = webCtx.webServer;
        if (!server)
            return;
        webCtx.effect(() => registerRoutes(server, rowConfig), 'tapd-in-dsh: /tapd 路由');
        const view = publicConfig(rowConfig);
        webCtx.logger?.info?.(`[tapd-in-dsh] 面板路由就绪 /tapd；workspace=${view.workspaceId || '(unset)'} 鉴权=${view.configured ? 'ok' : 'missing'}（来源 ${view.source}）`);
    });
}
function registerTools(ctx, getClient, config) {
    ctx.tools.register(defineTool({
        name: 'tapd_list_stories',
        description: '按条件查询 TAPD 需求列表。支持按标题关键词、处理人、状态、迭代过滤；不传 workspace_id 时用插件配置的默认项目。返回每条需求的摘要和一个可直接粘贴到对话里的引用 token。',
        parameters: {
            workspace_id: { type: 'string', description: 'TAPD 项目 ID，缺省用配置里的默认项目' },
            name: { type: 'string', description: '需求标题关键词（模糊匹配）' },
            owner: { type: 'string', description: '处理人 TAPD 用户名' },
            status: { type: 'string', description: '需求状态，如 planning / developing / testing / done' },
            iteration_id: { type: 'string', description: '迭代 ID' },
            limit: { type: 'number', description: '返回条数，默认 30，最大 200' },
            page: { type: 'number', description: '页码，默认 1' },
        },
        output: jsonOutput,
        async execute(args, exec) {
            const stories = await getClient().listStories({
                ...(args.workspace_id ? { workspaceId: args.workspace_id } : {}),
                ...(args.name ? { name: args.name } : {}),
                ...(args.owner ? { owner: args.owner } : {}),
                ...(args.status ? { status: args.status } : {}),
                ...(args.iteration_id ? { iterationId: args.iteration_id } : {}),
                ...(args.limit ? { limit: args.limit } : {}),
                ...(args.page ? { page: args.page } : {}),
            }, exec.signal);
            return {
                count: stories.length,
                stories: stories.map((story) => ({ ...story, reference: formatReference(story) })),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'tapd_get_story',
        description: '读取单个 TAPD 需求的完整内容（含描述正文）。用户给了需求 ID，或提到某个需求要细看时调用。',
        parameters: {
            id: { type: 'string', required: true, description: '需求 ID' },
            workspace_id: { type: 'string', description: 'TAPD 项目 ID，缺省用配置里的默认项目' },
        },
        output: jsonOutput,
        async execute(args, exec) {
            const story = await getClient().getStory(args.id, {
                ...(args.workspace_id ? { workspaceId: args.workspace_id } : {}),
                signal: exec.signal,
            });
            return { ...story, reference: formatReference(story) };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'tapd_update_story',
        description: '更新 TAPD 需求的状态 / 处理人 / 优先级。这是写操作，执行前必须先向用户复述将要修改的字段并获得明确确认。',
        parameters: {
            id: { type: 'string', required: true, description: '需求 ID' },
            workspace_id: { type: 'string', description: 'TAPD 项目 ID，缺省用配置里的默认项目' },
            status: { type: 'string', description: '新状态' },
            owner: { type: 'string', description: '新处理人 TAPD 用户名' },
            priority_label: { type: 'string', description: '新优先级，建议用中文标签，如「高」' },
            current_user: { type: 'string', description: '变更人（记录操作者，非处理人）' },
        },
        output: jsonOutput,
        async execute(args, exec) {
            const story = await getClient().updateStory({
                id: args.id,
                ...(args.workspace_id ? { workspaceId: args.workspace_id } : {}),
                ...(args.status ? { status: args.status } : {}),
                ...(args.owner ? { owner: args.owner } : {}),
                ...(args.priority_label ? { priority_label: args.priority_label } : {}),
                ...(args.current_user ? { current_user: args.current_user } : {}),
            }, exec.signal);
            return { updated: true, story: { ...story, reference: formatReference(story) } };
        },
    }));
    ctx.logger?.info?.(`[tapd-in-dsh] tools ready; workspace=${config.workspaceId ?? process.env['TAPD_WORKSPACE_ID'] ?? '(unset)'}`);
}
/**
 * 引用展开：在 agent/pre-step 这个 waterfall 上，把带 @tapd 引用的那一步
 * 追加一条 plugin 来源的上下文消息。来源标记为 plugin，所以不会被自己再扫到。
 */
function registerReferenceInjection(ctx, getClient, config) {
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        const userTexts = decision.messages
            .filter((message) => message.source.kind === 'user')
            .flatMap((message) => message.content)
            .filter((block) => block.type === 'text')
            .map((block) => block.text);
        const references = collectReferences(userTexts).slice(0, config.maxReferences);
        if (!references.length)
            return decision;
        const blocks = [];
        for (const reference of references) {
            if (payload.signal.aborted)
                return decision;
            try {
                const story = await getClient().getStory(reference.storyId, {
                    ...(reference.workspaceId ? { workspaceId: reference.workspaceId } : {}),
                    signal: payload.signal,
                });
                blocks.push(...renderStoryContext(story, config.maxBodyChars));
            }
            catch (error) {
                const reason = error instanceof TapdError ? error.message : String(error);
                blocks.push(...renderReferenceFailure(reference, reason));
            }
        }
        if (!blocks.length)
            return decision;
        return {
            kind: 'enter',
            messages: [
                ...decision.messages,
                createUserMessage({
                    content: blocks,
                    source: {
                        kind: 'plugin',
                        plugin: 'tapd-in-dsh',
                        form: 'notice',
                        summary: `已注入 ${references.length} 个 TAPD 需求`,
                    },
                }),
            ],
        };
    });
}
/** 供后续面板复用：把需求渲染成 Markdown 摘要。 */
export function toMarkdown(story) {
    return [
        `### ${story.name ?? '(无标题)'} (#${story.id})`,
        `- 状态：${story.status ?? '未知'}`,
        `- 处理人：${story.owner ?? '未指派'}`,
        `- 优先级：${story.priority_label ?? '未设置'}`,
        `- 链接：${story.url}`,
        '',
        story.description ?? '',
    ].join('\n');
}
//# sourceMappingURL=index.js.map