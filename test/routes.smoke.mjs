/**
 * 路由冒烟测试：用假的 req/res 直接打 registerRoutes 挂出来的 handler，
 * 再起一个本地假 TAPD 验证列表 / 详情 / 探活三条链路。
 * 运行：node test/routes.smoke.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapd-smoke-'))
process.env.DSH_HOME = tmp

const { registerRoutes } = await import('../lib/routes.js')

/** 假 TAPD：按文档的 { status, data } 信封回话。 */
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (payload) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (url.pathname !== '/stories') return send({ status: 0, info: 'not found' })
  const id = url.searchParams.get('id')
  if (id) {
    return send({
      status: 1,
      data: [{ Story: { id, name: '登录改造', status: 'developing', owner: 'fen', workspace_id: url.searchParams.get('workspace_id'), description: '正文内容' } }],
    })
  }
  return send({
    status: 1,
    data: [
      { Story: { id: '101', name: '登录改造', status: 'developing', owner: 'fen', priority_label: '高', description: '很长'.repeat(100) } },
      { Story: { id: '102', name: '额度重算', status: 'planning' } },
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
 * @param method HTTP 方法
 * @param pathname 带查询串的路径
 * @param body 请求体
 */
async function call(method, pathname, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = `/tapd${pathname}`
  const chunks = []
  const res = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(payload) {
      if (payload) chunks.push(Buffer.from(payload))
      this.body = Buffer.concat(chunks).toString('utf8')
      this.json = this.body ? JSON.parse(this.body) : null
      if (this.resolve) this.resolve()
    },
  }
  const done = new Promise((resolve) => {
    res.resolve = resolve
  })
  await handler(req, res)
  await done
  return { status: res.status, json: res.json }
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
check('列表不带正文', stories[0]?.description === undefined)

reply = await call('GET', '/__story?id=101')
check('详情带正文', reply.json.story?.description === '正文内容', reply.json)
check('详情带引用 token（含项目 ID）', reply.json.story?.reference === '@tapd:story:10104801/101', reply.json.story?.reference)

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
