/**
 * 路由冒烟测试：用假的 req/res 直接打 registerRoutes 挂出来的 handler，
 * 再起一个本地假 TAPD 验证列表 / 详情 / 探活三条链路。
 * 运行：node test/routes.smoke.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapd-smoke-'))
process.env.DSH_HOME = tmp

const { registerRoutes } = await import('../lib/routes.js')

/** 假 TAPD：按文档的 { status, data } 信封回话。 */
let lastStoriesQuery = null
/** 一张 1x1 的 PNG，用来验证图片是「原样转发字节」而不是改写成 JSON。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (payload) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  // 图片签名接口：真地址指向本进程的 /file/<name>，好让转发路径可断言
  if (url.pathname === '/files/get_image') {
    const imagePath = url.searchParams.get('image_path') ?? ''
    if (imagePath.includes('missing')) return send({ status: 0, info: '图片不存在' })
    return send({
      status: 1,
      data: { Attachment: { download_url: `${fakeBase}/file/${imagePath.split('/').pop()}`, filename: 'a.png' } },
    })
  }
  if (url.pathname.startsWith('/file/')) {
    // 真实 TAPD 的 file.tapd.cn 就回这种残缺类型（只有 image 没有子类型），照抄以锁死修正逻辑
    res.writeHead(200, { 'content-type': 'image', 'content-length': PNG.length })
    return res.end(PNG)
  }
  if (url.pathname === '/stories/count') return send({ status: 1, data: { count: 42 } })
  if (url.pathname === '/workflows/status_map') {
    return send({ status: 1, data: { planning: '规划中', developing: '实现中' } })
  }
  if (url.pathname === '/iterations') {
    return send({ status: 1, data: [{ Iteration: { id: 'it1', name: '紧急更新', status: 'open' } }] })
  }
  if (url.pathname === '/workspaces/users') {
    return send({ status: 1, data: [{ UserWorkspace: { user: 'fen', name: '芬' } }] })
  }
  if (url.pathname !== '/stories') return send({ status: 0, info: 'not found' })
  lastStoriesQuery = Object.fromEntries(url.searchParams)
  const id = url.searchParams.get('id')
  if (id) {
    return send({
      status: 1,
      data: [{ Story: { id, name: '登录改造', status: 'developing', owner: 'fen', workspace_id: url.searchParams.get('workspace_id'), description: '<div><b>正文内容</b></div>' } }],
    })
  }
  return send({
    status: 1,
    data: [
      {
        Story: {
          id: '101',
          name: '登录改造',
          status: 'developing',
          owner: 'fen',
          priority_label: '高',
          // 真实正文是 HTML，摘要必须是折叠后的文本，不能把标签漏给列表
          description: `<div><p>${'很长'.repeat(100)}</p><p><img src="/tfl/captures/a.png"></p></div>`,
        },
      },
      { Story: { id: '102', name: '额度重算', status: 'planning', description: '<div>说明</div><p><img src="/tfl/captures/a.png"></p>' } },
    ],
  })
})
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
const fakeBase = `http://127.0.0.1:${fake.address().port}`

/** 挂到假 web server 上，拿到 handler。 */
let handler
registerRoutes(
  {
    register: (route) => {
      handler = route.handler
      return () => {}
    },
  },
  {},
)

/**
 * 造一个假的 req/res 对。
 *
 * res 用真的 Writable：图片是流式转发的（pipe），普通对象接不住 write/pipe。
 * @param method HTTP 方法
 * @param pathname 带查询串的路径
 * @param body 请求体
 */
async function call(method, pathname, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = `/tapd${pathname}`
  const chunks = []
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  res.status = 0
  res.headers = {}
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = headers ?? {}
  }
  await handler(req, res)
  // 流式响应在 handler 返回之后才写完，等 finish（JSON 响应此时已经 finish 过了）
  if (!res.writableFinished) {
    await new Promise((resolve) => {
      res.once('finish', resolve)
      res.once('close', resolve)
      setTimeout(resolve, 1000).unref?.()
    })
  }
  const buffer = Buffer.concat(chunks)
  const text = buffer.toString('utf8')
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null // 图片等二进制响应不该按 JSON 解
  }
  return { status: res.status, headers: res.headers, body: text, buffer, json }
}

let failures = 0
const check = (name, condition, extra) => {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}`, extra ?? '')
  }
}

console.log('配置端点')
let reply = await call('GET', '/__config')
check('未配置时 configured=false', reply.status === 200 && reply.json.config.configured === false, reply.json)

reply = await call('POST', '/__test', { workspaceId: '10104801', apiToken: 'tok_123', baseUrl: fakeBase })
check('未保存也能按屏幕上的值探活', reply.json.ok === true && reply.json.workspaceId === '10104801', reply.json)

reply = await call('PUT', '/__config', { workspaceId: '10104801', apiToken: 'tok_123', baseUrl: fakeBase })
check('保存后 configured=true', reply.json.config.configured === true, reply.json)
check('令牌不外泄', JSON.stringify(reply.json).includes('tok_123') === false, reply.json)
check('落盘到 $DSH_HOME/tapd/config.json', fs.existsSync(path.join(tmp, 'tapd', 'config.json')))

reply = await call('GET', '/__stories?keyword=登录')
const stories = reply.json.stories ?? []
check('列表返回 2 条', stories.length === 2, reply.json)
check('行内带引用 token', stories[0]?.reference === '@tapd:story:101', stories[0]?.reference)
check('长描述被截断', typeof stories[0]?.summary === 'string' && stories[0].summary.length <= 121, stories[0]?.summary?.length)
check('摘要折叠成纯文本（不漏标签）', !/[<>]/.test(stories[0]?.summary ?? ''), stories[0]?.summary)
check('摘要里图片折成占位文字', (stories[1]?.summary ?? '').includes('[图片]'), stories[1]?.summary)
check('列表不带正文', stories[0]?.description === undefined)
check('带总数（用于「共 N 条」）', reply.json.total === 42, reply.json.total)

reply = await call('GET', '/__stories?limit=2')
check('满页且总数更大时 hasMore=true', reply.json.hasMore === true, reply.json)

reply = await call('GET', '/__stories?limit=2&page=2')
check('页码透传给 TAPD', lastStoriesQuery.page === '2', lastStoriesQuery.page)

reply = await call('GET', '/__stories?status=developing&owner=fen&iteration=it1')
check(
  '状态 / 处理人 / 迭代三个筛选都透传',
  lastStoriesQuery.status === 'developing' && lastStoriesQuery.owner === 'fen' && lastStoriesQuery.iteration_id === 'it1',
  lastStoriesQuery,
)

reply = await call('GET', '/__filters')
check('状态表映射成下拉项', reply.json.statuses?.some((item) => item.key === 'developing' && item.name === '实现中'), reply.json.statuses)
check('迭代下拉项带 id 与名字', reply.json.iterations?.[0]?.id === 'it1' && reply.json.iterations?.[0]?.name === '紧急更新', reply.json.iterations)
check('成员下拉项带 user 与名字', reply.json.members?.[0]?.user === 'fen' && reply.json.members?.[0]?.name === '芬', reply.json.members)
check('筛选器全部成功时不报错', reply.json.errors === undefined, reply.json.errors)

reply = await call('GET', '/__story?id=101')
check('详情原样保留正文 HTML（渲染交给面板）', reply.json.story?.description === '<div><b>正文内容</b></div>', reply.json.story?.description)
check('详情带引用 token（含项目 ID）', reply.json.story?.reference === '@tapd:story:10104801/101', reply.json.story?.reference)

console.log('正文图片')
reply = await call('GET', '/__image?path=%2Ftfl%2Fcaptures%2F2026-10%2Fa.png')
check('图片按字节转发', reply.status === 200 && reply.buffer.equals(PNG), `${reply.status} ${reply.body?.slice(0, 60)}`)
check('残缺的 image 类型按后缀补全', reply.headers['content-type'] === 'image/png', reply.headers['content-type'])
check('图片允许浏览器缓存', /max-age=\d+/.test(reply.headers['cache-control'] ?? ''), reply.headers['cache-control'])

reply = await call('GET', '/__image?path=%2F..%2F..%2Fetc%2Fpasswd.png')
check('路径穿越被挡住', reply.status === 400 && (reply.headers['content-type'] ?? '').includes('svg'), reply.status)

reply = await call('GET', '/__image?path=%2Ftfl%2Fcaptures%2Fa.txt')
check('非图片后缀被挡住', reply.status === 400, reply.status)

reply = await call('GET', '/__image?path=%2Ftfl%2Fcaptures%2Fmissing.png')
check('取不到图时回占位图而不是报错页', reply.status === 502 && reply.body.includes('图片加载失败'), reply.status)

reply = await call('POST', '/__test')
check('探活成功', reply.json.ok === true && reply.json.workspaceId === '10104801', reply.json)

console.log('异常路径')
reply = await call('GET', '/nope')
check('未知端点 404', reply.status === 404, reply.status)

fs.writeFileSync(path.join(tmp, 'tapd', 'config.json'), '{ 坏掉的 json')
reply = await call('GET', '/__config')
check('设置文件损坏时不被拖垮', reply.status === 200 && reply.json.config.configured === false, reply.json)

fake.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
