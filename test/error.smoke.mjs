/**
 * 鉴权失败时的错误透传测试。
 *
 * 背景：TAPD 在 4xx 时仍会返回 { status, info }，info 才是真正原因
 * （如 422 "The access token provided is invalid"）。早期实现只抛
 * 「TAPD 返回 HTTP 422」，用户完全不知道是令牌无效，排查成本很高。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { TapdClient, TapdError } from '../lib/tapd.js'

/** 起一个假 TAPD，按给定状态码和响应体回话。 */
function startFakeTapd(status, body) {
  const server = createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}

/** 打一次 listStories，返回抛出的 TapdError。 */
async function catchError(baseUrl) {
  const client = new TapdClient({
    auth: { token: 'whatever' },
    defaultWorkspaceId: '10104801',
    baseUrl,
    timeoutMs: 5000,
  })
  try {
    await client.listStories({ limit: 1 })
    return null
  } catch (error) {
    return error
  }
}

const cases = [
  {
    name: '422 令牌无效',
    status: 422,
    body: { status: 422, data: '', info: 'The access token provided is invalid' },
    expect: ['The access token provided is invalid', '令牌无效', '重新生成'],
  },
  {
    name: '401 没带凭据',
    status: 401,
    body: { status: 401, data: '', info: '401 Unauthorized' },
    expect: ['401 Unauthorized', '没带上鉴权信息'],
  },
  {
    name: '403 无权限（企业未开通 API 账号）',
    status: 403,
    body: { status: 403, data: '', info: 'forbidden' },
    expect: ['forbidden', '未开通 API 账号'],
  },
  {
    name: '403 跨企业填错项目 ID',
    status: 403,
    body: { status: 403, data: '', info: 'Personal token company does not match workspace' },
    expect: ['company does not match', '只能访问自己企业的项目'],
  },
  {
    name: '403 不是该项目成员',
    status: 403,
    body: { status: 403, data: '', info: 'api account tapd_my_token not allowed to access project 36821177' },
    expect: ['not allowed to access project', '项目成员'],
  },
]

let failed = 0
for (const item of cases) {
  const { server, baseUrl } = await startFakeTapd(item.status, item.body)
  try {
    const error = await catchError(baseUrl)
    assert.ok(error instanceof TapdError, `${item.name}：应抛出 TapdError`)
    assert.equal(error.status, item.status, `${item.name}：status 应保留`)
    for (const fragment of item.expect) {
      assert.ok(
        error.message.includes(fragment),
        `${item.name}：错误消息应包含「${fragment}」，实际是「${error.message}」`,
      )
    }
    console.log(`  ok  ${item.name} → ${error.message}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL ${item.name}: ${error.message}`)
  } finally {
    server.close()
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个用例失败`)
  process.exit(1)
}
console.log('\n错误透传测试：全部通过')
