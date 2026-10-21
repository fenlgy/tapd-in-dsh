/**
 * 客户端半区冒烟测试：用假的模块加载器和极简 React 垫片，
 * 执行 client.js 并检查它把面板页与侧栏入口挂到了正确的位置。
 * 运行：node test/client.smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/** 记录 loader 收到的模块。 */
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}
globalThis.__DSH_TRANSPORT__ = undefined

// 执行浏览器半区的源码（它只会登记模块，不会挂载）。
new Function('window', source)(globalThis.window)

assert.ok(loaded, 'client.js 没有调用 window.__ModuleLoader__.load')
assert.equal(loaded.id, 'tapd-in-dsh', '模块 id 必须是包名')

/** 极简 React 垫片：只满足 createElement 与 hook 的静态调用。 */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
}

const moduleExports = loaded.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`客户端半区只允许 require('react')，却请求了 ${specifier}`)
})

assert.equal(typeof moduleExports.apply, 'function', '必须导出 apply')
assert.deepEqual(moduleExports.inject, ['slots', 'locale'], 'inject 声明不对')

/** 收集注册到插槽的东西。 */
const registrations = []
const disposers = []
const ctx = {
  effect: (factory) => {
    const dispose = factory()
    disposers.push(dispose)
  },
  locale: {
    register: (ns, dict) => {
      registrations.push({ kind: 'locale', ns, dict })
      return () => {}
    },
    bind: (ns) => (key) => {
      const record = registrations.find((item) => item.kind === 'locale' && item.ns === ns)
      return record?.dict?.zh?.[key] ?? record?.dict?.en?.[key] ?? key
    },
  },
  slots: {
    inject: (name, run) => {
      run()
    },
    register: (decl, component) => {
      registrations.push({ kind: 'slot', decl, component })
      return () => {}
    },
  },
}

moduleExports.apply(ctx)

const slots = registrations.filter((item) => item.kind === 'slot').map((item) => item.decl)
const main = slots.find((decl) => decl.name === 'main')
const entry = slots.find((decl) => decl.name === 'sidebar.panellist')

assert.ok(main, '没有注册 main 插槽')
assert.equal(main.key, 'tapd', 'main 的 key 必须与侧栏入口 id 一致')
assert.ok(entry, '没有注册 sidebar.panellist')
assert.equal(entry.id, main.key, '侧栏入口 id 与 main key 必须一致，否则点了打不开')
assert.equal(typeof entry.label, 'function', '侧栏入口的 label 必须是函数（随语言切换）')
assert.equal(entry.label(), 'TAPD', '侧栏入口标题应为 TAPD')

const pageComp = registrations.find((item) => item.kind === 'slot' && item.decl.name === 'main').component
assert.equal(typeof pageComp, 'function', 'main 必须注册一个组件')

// 页面组件能被调用而不抛错（垫片下渲染成普通对象树）。
const dict = registrations.find((item) => item.kind === 'locale')?.dict?.zh ?? {}
const outer = pageComp({ t: (key) => dict[key] ?? key })
assert.ok(outer && typeof outer === 'object', '页面组件没有返回可渲染元素')
// 注册的组件是一层包了 t 的壳，真正渲染的是它里面的页面组件。
const inner = typeof outer.type === 'function' ? outer.type(outer.props) : outer
assert.ok(
  JSON.stringify(inner).includes('TAPD'),
  '页面里应该出现 TAPD 字样（来自 zh 词典的 panel）',
)

// 侧栏图标组件要能吃 { size } 并返回 svg 元素。
const iconComp = registrations.find((item) => item.kind === 'slot' && item.decl.name === 'sidebar.panellist').component
const iconTree = iconComp({ size: 18 })
assert.equal(iconTree.type, 'svg', '侧栏图标应渲染 svg')

/**
 * 请求地址必须与页面同源（0.2.5 修的就是这里）。
 * 桌面端页面在 dsh-app://app，跨源直打 http://127.0.0.1:<端口> 会被浏览器拦掉。
 */
const calls = []
globalThis.document = { baseURI: 'dsh-app://app/index.html' }
globalThis.location = { href: 'dsh-app://app/index.html' }
globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: 'http://127.0.0.1:3080', ownsHost: true }
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: (init && init.method) || 'GET' })
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ config: { configured: true }, stories: [] }),
  }
}

/** 把函数组件就地展开成原生元素树（垫片下没有调和器）。 */
const expand = (node) => {
  if (Array.isArray(node)) return node.map(expand)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children && node.children.length > 0) {
      props.children = node.children.length === 1 ? node.children[0] : node.children
    }
    const out = node.type(props)
    return out && typeof out === 'object' ? expand(out) : out
  }
  return { ...node, children: (node.children || []).map(expand) }
}

/** 按显示文字找原生按钮。 */
const findButton = (node, label) => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label)
      if (found) return found
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button' && node.children && node.children[0] === label) return node
  return findButton(node.children, label)
}

// 未配置时页面渲染的就是配置表单，点「保存」应该发一笔同源 PUT。
const saveButton = findButton(expand(inner), '保存')
assert.ok(saveButton && typeof saveButton.props.onClick === 'function', '配置卡片里应有「保存」按钮')
await saveButton.props.onClick()
assert.ok(calls.length > 0, '点保存没有发出任何请求')
for (const call of calls) {
  assert.ok(call.url.startsWith('dsh-app://app/tapd/'), `请求必须与页面同源，实际是 ${call.url}`)
}
assert.equal(calls[0].method, 'PUT', '保存应使用 PUT')
assert.notEqual(calls[0].url, 'http://127.0.0.1:3080/tapd/__config', '不允许直连宿主监听地址')

console.log('客户端半区冒烟测试：全部通过')
