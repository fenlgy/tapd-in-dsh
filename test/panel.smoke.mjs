/**
 * 面板渲染冒烟测试：jsdom + 真 React 挂载，专门盯「需求正文按 HTML 渲染」这条链路。
 *
 * 起因：TAPD 的 description 是富文本编辑器导出的 HTML 源码，面板原来当纯文本显示，
 * 用户看到的是 `<div><p>...` 一堆标签。这里锁住三件事：
 *   1. 标签真的被渲染成 DOM（不是显示源码）；
 *   2. 危险内容（script / on* 事件 / javascript: 链接 / position 样式）被白名单挡掉；
 *   3. 正文图片走宿主的 /tapd/__image 代理，不是直连 www.tapd.cn。
 *
 * 运行：node test/panel.smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/** 真实 TAPD 正文的骨架 + 一串攻击载荷，用来验证「能渲染」和「不乱渲染」。 */
const RICH_DESCRIPTION = [
  '<div><b>需求描述：</b></div>',
  '<div><p>现状：<span style="color: rgb(255, 0, 0); position: absolute">红色文字</span>超出输入框</p></div>',
  '<p class="tox-clear-float"><img src="/tfl/captures/2026-10/tapd_40008871_base64_1.png" width="80%" onerror="alert(1)"></p>',
  '<div><a href="javascript:alert(1)">点我</a><a href="https://www.tapd.cn/40008871/prong/stories/view/1">在 TAPD 看</a></div>',
  '<table><tbody><tr><th>字段</th><td>值</td></tr></tbody></table>',
  '<script>alert("xss")</script>',
  '<style>body{display:none}</style>',
  '<div onclick="alert(2)">纯文本段落</div>',
].join('')

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.location = window.location
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node

const stories = [
  { id: '1003002', name: '带富文本正文的需求', status: 'planning', owner: '芬', summary: '需求描述：现状……' },
  { id: '1003003', name: '正文只有一个空 div 的需求', status: 'planning', owner: '芬', summary: '' },
]

/** 按 id 返回详情正文：第二条故意是空壳，用来验证「空正文显示空态」。 */
const detailFor = (id) =>
  id === '1003003' ? { description: '<div><br/></div>' } : { description: RICH_DESCRIPTION }

const calls = []
const reply = (payload) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(payload),
})
globalThis.fetch = async (url) => {
  const target = String(url)
  calls.push(target)
  if (target.includes('/tapd/__config')) {
    return reply({ config: { configured: true, workspaceId: '40008871', hasToken: true, hasBasic: false, source: 'store' } })
  }
  if (target.includes('/tapd/__filters')) {
    return reply({ configured: true, statuses: [{ key: 'planning', name: '规划中' }], iterations: [], members: [] })
  }
  if (target.includes('/tapd/__story')) {
    const id = new URL(target).searchParams.get('id')
    return reply({ story: { ...stories.find((item) => item.id === id), ...detailFor(id), workspace_id: '40008871' } })
  }
  return reply({ configured: true, page: 1, limit: 20, total: 2, hasMore: false, stories })
}

let loaded
window.__ModuleLoader__ = { load: (entry) => { loaded = entry } }
new Function('window', source)(window)
assert.ok(loaded, 'client.js 没有注册模块')

const mod = loaded.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`客户端半区只允许 require('react')，却请求了 ${specifier}`)
})

const registrations = []
mod.apply({
  effect: (factory) => factory(),
  locale: {
    register: (ns, dict) => {
      registrations.push({ kind: 'locale', ns, dict })
      return () => {}
    },
    bind: (ns) => (key) => registrations.find((r) => r.kind === 'locale' && r.ns === ns)?.dict?.zh?.[key] ?? key,
  },
  slots: {
    inject: (name, run) => run(),
    register: (decl, component) => {
      registrations.push({ kind: 'slot', decl, component })
      return () => {}
    },
  },
})

const dict = registrations.find((item) => item.kind === 'locale').dict.zh
const t = (key, params) => {
  const template = dict[key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template
}

/** React 的告警单独收集，最后统一断言，避免被日志刷没。 */
const warnings = []
const originalError = console.error
console.error = (...args) => warnings.push(args.filter((item) => typeof item === 'string').join(' '))

let failures = 0
const check = (name, condition, extra) => {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}
const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
const click = (element) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

const pageComp = registrations.find((item) => item.kind === 'slot' && item.decl.name === 'main').component
const root = createRoot(document.getElementById('root'))
root.render(React.createElement(pageComp, { t }))
await wait(140)

check('列表渲染出两行', document.querySelectorAll('.tapd-row').length === 2)

// 打开第一条：正文应按 HTML 渲染
click(document.querySelectorAll('.tapd-row')[0])
await wait(140)

const rich = document.querySelector('.tapd-rich')
check('详情里有富文本容器 .tapd-rich', Boolean(rich))
if (!rich) {
  console.error = originalError
  console.log(`\n${failures} 项失败`)
  process.exit(1)
}

check('标签被渲染成 DOM 而不是当文本显示', !/&lt;(div|p|b)\b/.test(rich.innerHTML))
check('<b> 生效', rich.querySelector('b')?.textContent === '需求描述：')
check('<p> 生效', rich.querySelectorAll('p').length >= 1)
check('文本没有被吞掉', rich.textContent.includes('超出输入框'))

const img = rich.querySelector('img')
check('图片节点保留', Boolean(img))
check(
  '正文图片改走宿主代理',
  Boolean(img) && img.getAttribute('src').startsWith('http://127.0.0.1:3080/tapd/__image?path='),
  img?.getAttribute('src'),
)
check(
  '图片路径被完整编码进代理参数',
  Boolean(img) && decodeURIComponent(img.getAttribute('src')).includes('/tfl/captures/2026-10/tapd_40008871_base64_1.png'),
  img?.getAttribute('src'),
)
check('图片宽度属性保留（排版不失真）', img?.getAttribute('width') === '80%', img?.getAttribute('width'))
check('on* 事件属性被摘掉', img?.hasAttribute('onerror') === false)

check('script 整块丢弃', rich.querySelectorAll('script').length === 0)
check('style 整块丢弃', rich.querySelectorAll('style').length === 0)
check('内联事件被摘掉', rich.querySelector('div[onclick]') === null)

const links = rich.querySelectorAll('a')
const jsLink = [...links].find((el) => el.textContent === '点我')
const tapdLink = [...links].find((el) => el.textContent === '在 TAPD 看')
check('javascript: 链接不给 href', jsLink?.hasAttribute('href') === false)
check('正常链接保留且新窗口打开', tapdLink?.getAttribute('target') === '_blank' && Boolean(tapdLink?.getAttribute('href')))

const colored = rich.querySelector('span[style]')
check('颜色样式保留', Boolean(colored) && /color/.test(colored.getAttribute('style')), colored?.getAttribute('style'))
check('定位样式被过滤', Boolean(colored) && !/position/.test(colored.getAttribute('style')), colored?.getAttribute('style'))

check('表格结构保留', rich.querySelector('table th')?.textContent === '字段' && rich.querySelector('table td')?.textContent === '值')

// 返回列表，打开第二条：正文是空壳时该显示空态，而不是一块空白
const back = [...document.querySelectorAll('button')].find((el) => el.textContent === dict.back)
check('详情页有返回按钮', Boolean(back))
click(back)
await wait(80)
click(document.querySelectorAll('.tapd-row')[1])
await wait(140)
check('正文只有空 div 时显示空态', Boolean(document.querySelector('.tapd-descEmpty')) && !document.querySelector('.tapd-rich'))

check('渲染过程没有 React 告警', warnings.length === 0, `\n- ${warnings.join('\n- ')}`)

console.error = originalError
root.unmount()
console.log(failures === 0 ? '面板渲染冒烟测试：全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
