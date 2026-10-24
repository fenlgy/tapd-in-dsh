/**
 * TAPD 的正文是富文本 HTML（TinyMCE 的产物），直接丢给模型或列表摘要都是源码噪音。
 * 这里只放「不需要 DOM 的降级」：把 HTML 折成可读文本。
 *
 * 浏览器侧的渲染是另一套（白名单 + DOM 清洗），在 client.js 里，
 * 因为那边要的是「保留结构、只留安全标签」，而不是拍平成文字。
 */

/** 块级标签收尾处换行，否则整段会粘成一行。 */
const BLOCK_END =
  /<\/(p|div|li|ul|ol|h[1-6]|blockquote|pre|tr|table|thead|tbody|section|article|header|footer|figure|figcaption|dd|dt)>/gi

/** 常见的命名实体；TAPD 编辑器主要产出这些，其余原样保留。 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  times: '×',
}

/**
 * 把一段 HTML 折成纯文本。
 * 图片折成 `[图片]`，列表项前置 `· `，块级标签折成换行。
 * @param html 正文 HTML（可能为空）
 * @returns 去掉标签与多余空行的文本
 */
export function htmlToText(html: string): string {
  if (!html) return ''
  const flattened = html
    // 脚本与样式整段丢掉，别让里面的字符漏进正文
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<img\b[^>]*>/gi, '[图片]')
    .replace(/<hr\b[^>]*>/gi, '\n')
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]+>/g, '')

  const lines = decodeEntities(flattened)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return lines
}

/** 单行摘要用：连换行一起拍平。 */
export function htmlToLine(html: string): string {
  return htmlToText(html).replace(/\s+/g, ' ')
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}
