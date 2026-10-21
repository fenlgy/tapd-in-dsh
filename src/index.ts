/**
 * tapd-in-dsh —— DeepSeek Harness 插件宿主半区。
 *
 * 两件事：
 * 1. 注册 tapd_* 工具，让模型能查询 / 更新 TAPD 需求；
 * 2. 监听 agent/pre-step，把会话里的 `@tapd:story:<id>` 引用展开成需求正文。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { collectReferences, formatReference, renderReferenceFailure, renderStoryContext } from './reference.js'
import { TapdClient, TapdError } from './tapd.js'
import type { TapdStory } from './tapd.js'

export const name = 'tapd-in-dsh'

/** 只依赖工具注册表；事件监听走 cordis 核心，无需额外服务。 */
export const inject = ['tools']

export interface Config {
  /** TAPD 开放应用 ID / API 账号（Basic Auth） */
  apiUser?: string
  /** TAPD 开放应用秘钥 / API 密码（Basic Auth） */
  apiPassword?: string
  /** TAPD 个人访问令牌（Bearer），与 apiUser/apiPassword 二选一 */
  apiToken?: string
  /** 默认项目 ID，单项目使用时只配这里即可 */
  workspaceId?: string
  /** 接口地址，私有化部署时改这里 */
  baseUrl: string
  /** 单次请求超时（毫秒） */
  timeoutMs: number
  /** 是否在发送前展开 @tapd 引用 */
  injectReference: boolean
  /** 单轮最多展开几个引用，防止一次塞爆上下文 */
  maxReferences: number
  /** 单条需求描述注入上限（字符） */
  maxBodyChars: number
}

export const Config: Schema<Config> = Schema.object({
  apiUser: Schema.string().description('TAPD 开放应用 ID / API 账号'),
  apiPassword: Schema.string().role('secret').description('TAPD 开放应用秘钥 / API 密码'),
  apiToken: Schema.string().role('secret').description('TAPD 个人访问令牌（Bearer）'),
  workspaceId: Schema.string().description('默认 TAPD 项目 ID'),
  baseUrl: Schema.string().default('https://api.tapd.cn').description('TAPD 接口地址'),
  timeoutMs: Schema.number().default(15000).description('单次请求超时（毫秒）'),
  injectReference: Schema.boolean().default(true).description('发送前是否展开 @tapd:story:<id> 引用'),
  maxReferences: Schema.number().default(5).description('单轮最多展开的引用条数'),
  maxBodyChars: Schema.number().default(8000).description('单条需求描述注入上限（字符）'),
})

const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown): ContentBlock[] => [
    { type: 'text', text: JSON.stringify(value, null, 2) },
  ],
}

export function apply(ctx: Context, config: Config): void {
  const client = new TapdClient({
    auth: {
      user: config.apiUser ?? process.env['TAPD_API_USER'],
      password: config.apiPassword ?? process.env['TAPD_API_PASSWORD'],
      token: config.apiToken ?? process.env['TAPD_API_TOKEN'],
    },
    defaultWorkspaceId: config.workspaceId ?? process.env['TAPD_WORKSPACE_ID'],
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  })

  registerTools(ctx, client, config)
  if (config.injectReference) registerReferenceInjection(ctx, client, config)
}

function registerTools(ctx: Context, client: TapdClient, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'tapd_list_stories',
      description:
        '按条件查询 TAPD 需求列表。支持按标题关键词、处理人、状态、迭代过滤；不传 workspace_id 时用插件配置的默认项目。返回每条需求的摘要和一个可直接粘贴到对话里的引用 token。',
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
        const stories = await client.listStories(
          {
            ...(args.workspace_id ? { workspaceId: args.workspace_id } : {}),
            ...(args.name ? { name: args.name } : {}),
            ...(args.owner ? { owner: args.owner } : {}),
            ...(args.status ? { status: args.status } : {}),
            ...(args.iteration_id ? { iterationId: args.iteration_id } : {}),
            ...(args.limit ? { limit: args.limit } : {}),
            ...(args.page ? { page: args.page } : {}),
          },
          exec.signal,
        )
        return {
          count: stories.length,
          stories: stories.map((story) => ({ ...story, reference: formatReference(story) })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'tapd_get_story',
      description: '读取单个 TAPD 需求的完整内容（含描述正文）。用户给了需求 ID，或提到某个需求要细看时调用。',
      parameters: {
        id: { type: 'string', required: true, description: '需求 ID' },
        workspace_id: { type: 'string', description: 'TAPD 项目 ID，缺省用配置里的默认项目' },
      },
      output: jsonOutput,
      async execute(args, exec) {
        const story = await client.getStory(args.id, {
          ...(args.workspace_id ? { workspaceId: args.workspace_id } : {}),
          signal: exec.signal,
        })
        return { ...story, reference: formatReference(story) }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'tapd_update_story',
      description:
        '更新 TAPD 需求的状态 / 处理人 / 优先级。这是写操作，执行前必须先向用户复述将要修改的字段并获得明确确认。',
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
        const story = await client.updateStory(
          {
            id: args.id,
            ...(args.workspace_id ? { workspaceId: args.workspace_id } : {}),
            ...(args.status ? { status: args.status } : {}),
            ...(args.owner ? { owner: args.owner } : {}),
            ...(args.priority_label ? { priority_label: args.priority_label } : {}),
            ...(args.current_user ? { current_user: args.current_user } : {}),
          },
          exec.signal,
        )
        return { updated: true, story: { ...story, reference: formatReference(story) } }
      },
    }),
  )

  ctx.logger?.info?.(`[tapd-in-dsh] tools ready; workspace=${config.workspaceId ?? process.env['TAPD_WORKSPACE_ID'] ?? '(unset)'}`)
}

/**
 * 引用展开：在 agent/pre-step 这个 waterfall 上，把带 @tapd 引用的那一步
 * 追加一条 plugin 来源的上下文消息。来源标记为 plugin，所以不会被自己再扫到。
 */
function registerReferenceInjection(ctx: Context, client: TapdClient, config: Config): void {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const userTexts = decision.messages
      .filter((message) => message.source.kind === 'user')
      .flatMap((message) => message.content)
      .filter((block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)

    const references = collectReferences(userTexts).slice(0, config.maxReferences)
    if (!references.length) return decision

    const blocks: ContentBlock[] = []
    for (const reference of references) {
      if (payload.signal.aborted) return decision
      try {
        const story = await client.getStory(reference.storyId, {
          ...(reference.workspaceId ? { workspaceId: reference.workspaceId } : {}),
          signal: payload.signal,
        })
        blocks.push(...renderStoryContext(story, config.maxBodyChars))
      } catch (error) {
        const reason = error instanceof TapdError ? error.message : String(error)
        blocks.push(...renderReferenceFailure(reference, reason))
      }
    }
    if (!blocks.length) return decision

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
    }
  })
}

/** 供后续面板复用：把需求渲染成 Markdown 摘要。 */
export function toMarkdown(story: TapdStory): string {
  return [
    `### ${story.name ?? '(无标题)'} (#${story.id})`,
    `- 状态：${story.status ?? '未知'}`,
    `- 处理人：${story.owner ?? '未指派'}`,
    `- 优先级：${story.priority_label ?? '未设置'}`,
    `- 链接：${story.url}`,
    '',
    story.description ?? '',
  ].join('\n')
}
