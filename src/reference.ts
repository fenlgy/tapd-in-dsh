/**
 * 引用解析：把用户输入里的 `@tapd:story:<id>` 变成可注入模型上下文的文本。
 *
 * 引用只是普通文本，所以用户随时能手动删掉；发送时由宿主在 agent/pre-step
 * 边界把它展开成需求正文，模型不需要额外调一次工具。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TapdStory } from './tapd.js'

/**
 * 支持的引用写法：
 * - `@tapd:story:1010104801855983211` —— 用插件配置里的默认项目
 * - `@tapd:story:10104801/1010104801855983211` —— 显式指定项目
 */
const REFERENCE_PATTERN = /@tapd:story:(?:(\d+)\/)?(\d+)/g

export interface StoryReference {
  readonly workspaceId?: string
  readonly storyId: string
}

/** 从若干条消息的文本里抽出引用，按出现顺序去重。 */
export function collectReferences(texts: readonly string[]): StoryReference[] {
  const seen = new Set<string>()
  const references: StoryReference[] = []
  for (const text of texts) {
    for (const match of text.matchAll(REFERENCE_PATTERN)) {
      const workspaceId = match[1]
      const storyId = match[2]
      if (!storyId) continue
      const key = `${workspaceId ?? ''}/${storyId}`
      if (seen.has(key)) continue
      seen.add(key)
      references.push({ ...(workspaceId ? { workspaceId } : {}), storyId })
    }
  }
  return references
}

/** 拼出用户可直接粘进输入框的引用 token。 */
export function formatReference(story: TapdStory): string {
  return story.workspace_id ? `@tapd:story:${story.workspace_id}/${story.id}` : `@tapd:story:${story.id}`
}

/** 单条需求的模型可见上下文。 */
export function renderStoryContext(story: TapdStory, maxBodyChars: number): ContentBlock[] {
  const description = story.description ?? '（无描述）'
  const body = description.length > maxBodyChars ? `${description.slice(0, maxBodyChars)}\n…（描述已截断）` : description
  const lines = [
    `[TAPD 需求引用] ${story.name ?? '(无标题)'}`,
    `需求 ID：${story.id}${story.workspace_id ? ` · 项目：${story.workspace_id}` : ''}`,
    `状态：${story.status ?? '未知'} · 处理人：${story.owner ?? '未指派'} · 优先级：${story.priority_label ?? '未设置'}`,
    `类型：${story.type ?? '未知'} · 迭代：${story.iteration_id ?? '未关联'} · 更新：${story.modified ?? '未知'}`,
    `链接：${story.url}`,
    '',
    '描述：',
    body,
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

/** 引用展开失败时给模型的降级说明，避免整轮对话直接失败。 */
export function renderReferenceFailure(reference: StoryReference, reason: string): ContentBlock[] {
  const label = reference.workspaceId ? `${reference.workspaceId}/${reference.storyId}` : reference.storyId
  return [
    {
      type: 'text',
      text: `[TAPD 需求引用失败] 需求 ${label} 未能取回：${reason}\n请告知用户检查项目 ID / 需求 ID，或插件里的 TAPD 鉴权配置。`,
    },
  ]
}
