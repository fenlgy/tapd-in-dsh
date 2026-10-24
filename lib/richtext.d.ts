/**
 * TAPD 的正文是富文本 HTML（TinyMCE 的产物），直接丢给模型或列表摘要都是源码噪音。
 * 这里只放「不需要 DOM 的降级」：把 HTML 折成可读文本。
 *
 * 浏览器侧的渲染是另一套（白名单 + DOM 清洗），在 client.js 里，
 * 因为那边要的是「保留结构、只留安全标签」，而不是拍平成文字。
 */
/**
 * 把一段 HTML 折成纯文本。
 * 图片折成 `[图片]`，列表项前置 `· `，块级标签折成换行。
 * @param html 正文 HTML（可能为空）
 * @returns 去掉标签与多余空行的文本
 */
export declare function htmlToText(html: string): string;
/** 单行摘要用：连换行一起拍平。 */
export declare function htmlToLine(html: string): string;
//# sourceMappingURL=richtext.d.ts.map