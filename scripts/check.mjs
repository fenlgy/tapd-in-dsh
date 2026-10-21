#!/usr/bin/env node
/**
 * TAPD 凭据自检 —— 不依赖 DSH 宿主，单独验证「令牌 + 项目 ID」是否可用。
 *
 * 用途：把「凭据问题」和「插件问题」隔离开。客户报错时让他跑一遍，
 * 把输出贴回来，就能立刻判断卡在哪一层。
 *
 * 用法：
 *   node scripts/check.mjs --token=<个人访问令牌> --workspace=<项目ID>
 *   TAPD_API_TOKEN=xxx TAPD_WORKSPACE_ID=10104801 node scripts/check.mjs
 *
 * 免费企业同样适用（个人令牌 2000 次/天），与 TAPD 付费的「API 账号」无关。
 */
import { TapdClient, TapdError } from '../lib/tapd.js'

/** 解析 `--key=value` 形式的参数。 */
function parseArgs(argv) {
  const out = {}
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw)
    if (match) out[match[1]] = match[2]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const token = (args.token ?? process.env.TAPD_API_TOKEN ?? '').trim()
const workspaceId = (args.workspace ?? args.workspaceId ?? process.env.TAPD_WORKSPACE_ID ?? '').trim()
const baseUrl = (args.base ?? args.baseUrl ?? process.env.TAPD_BASE_URL ?? 'https://api.tapd.cn').trim()

/** 打印一行带状态标记的结果。 */
function line(ok, text) {
  console.log(`${ok === true ? '  ✓' : ok === false ? '  ✗' : '  ·'} ${text}`)
}

console.log('\nTAPD 凭据自检')
console.log(`  接口地址：${baseUrl}`)
console.log(`  项目 ID ：${workspaceId || '(未填)'}`)
console.log(`  令牌     ：${token ? `${token.slice(0, 4)}…${token.slice(-4)}（长度 ${token.length}）` : '(未填)'}`)

// 1. 参数齐不齐
if (!token) {
  console.log('\n[1/3] 参数检查')
  line(false, '没有令牌。TAPD 免费版也能用个人令牌：右上角头像 → 个人设置 → 个人访问令牌')
  console.log('\n用 --token=xxx --workspace=10104801 再跑一次\n')
  process.exit(2)
}
if (!workspaceId) {
  console.log('\n[1/3] 参数检查')
  line(false, '没有项目 ID。项目地址里 /tapd_fe/<项目ID>/ 那一段')
  console.log('\n用 --token=xxx --workspace=10104801 再跑一次\n')
  process.exit(2)
}
console.log('\n[1/3] 参数检查')
line(true, '令牌与项目 ID 都已提供')

// 2. 令牌 + 项目权限：真拉一条需求
const client = new TapdClient({
  auth: { token },
  defaultWorkspaceId: workspaceId,
  baseUrl,
  timeoutMs: 15000,
})

console.log('\n[2/3] 拉取需求（limit=1）')
let sample = null
try {
  const stories = await client.listStories({ limit: 1 })
  if (stories.length === 0) {
    line(true, '鉴权通过、项目可访问，但这个项目目前没有需求（或用当前账号看不到）')
  } else {
    sample = stories[0]
    line(true, `鉴权通过，读到需求：${sample.id} ${sample.name ?? ''}`.trim())
    if (sample.status) line(null, `状态：${sample.status}`)
    line(null, `引用写法：@tapd:story:${sample.id}`)
  }
} catch (error) {
  line(false, error instanceof TapdError ? error.message : String(error))
  console.log('\n[3/3] 结论')
  if (error instanceof TapdError && error.status === 422) {
    line(false, '令牌无效或已过期 → 去 TAPD 个人设置重新生成，注意复制完整、不要带空格')
  } else if (error instanceof TapdError && error.status === 403) {
    line(false, '令牌有效但无权限 → 可能是管理员在「公司管理 → 开放集成 → 个人令牌管理」限制了范围')
  } else if (error instanceof TapdError && error.status === 404) {
    line(false, '接口或项目不存在 → 核对项目 ID 是不是那串数字')
  } else {
    line(false, '不是鉴权问题，检查网络 / 接口地址（私有化部署要改 baseUrl）')
  }
  console.log('')
  process.exit(1)
}

// 3. 引用链路：读一条详情的正文
console.log('\n[3/3] 读取需求详情（引用 @tapd:story: 展开时用的接口）')
if (!sample) {
  line(null, '没有需求可抽样，跳过')
} else {
  try {
    const detail = await client.getStory(sample.id)
    const length = detail.description?.length ?? 0
    line(true, `详情接口正常，正文字符数 ${length}`)
    if (length === 0) line(null, '这条需求没有正文描述，属正常情况，换一条有描述的更能验证链路')
  } catch (error) {
    line(false, error instanceof TapdError ? error.message : String(error))
  }
}

console.log('\n结论：凭据可用，把同一个令牌填进插件面板「个人访问令牌」即可。\n')
