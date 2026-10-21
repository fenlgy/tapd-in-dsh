/**
 * 引用解析：把用户输入里的 `@tapd:story:<id>` 变成可注入模型上下文的文本。
 *
 * 引用只是普通文本，所以用户随时能手动删掉；发送时由宿主在 agent/pre-step
 * 边界把它展开成需求正文，模型不需要额外调一次工具。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { TapdStory } from './tapd.js';
export interface StoryReference {
    readonly workspaceId?: string;
    readonly storyId: string;
}
/** 从若干条消息的文本里抽出引用，按出现顺序去重。 */
export declare function collectReferences(texts: readonly string[]): StoryReference[];
/** 拼出用户可直接粘进输入框的引用 token。 */
export declare function formatReference(story: TapdStory): string;
/** 单条需求的模型可见上下文。 */
export declare function renderStoryContext(story: TapdStory, maxBodyChars: number): ContentBlock[];
/** 引用展开失败时给模型的降级说明，避免整轮对话直接失败。 */
export declare function renderReferenceFailure(reference: StoryReference, reason: string): ContentBlock[];
//# sourceMappingURL=reference.d.ts.map