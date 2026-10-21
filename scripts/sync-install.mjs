#!/usr/bin/env node
/**
 * 把当前工作副本同步进已安装的 DSH profile。
 *
 * 为什么需要它：插件装进 profile 后是 GitHub tarball 的一份拷贝，
 * 改完代码得重新装一遍才对得上。而重装（pnpm 拉 git 源）既慢又要过网络，
 * 所以这里直接把 package.json 的 files 清单覆盖到已装目录——
 * 效果等价于「重装同一份代码」，但配置（~/.dsh/tapd/config.json）原地不动。
 *
 * 用法：
 *   node scripts/sync-install.mjs            # 同步所有装了本插件的 profile
 *   node scripts/sync-install.mjs --check    # 只对比版本，不写盘
 *   node scripts/sync-install.mjs --profile desktop
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 解析命令行参数。 */
function parseArgs(argv) {
  const args = { check: false, profile: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check' || arg === '-n') args.check = true
    else if (arg === '--profile' || arg === '-p') args.profile = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/sync-install.mjs [--check] [--profile <name>]')
      process.exit(0)
    }
  }
  return args
}

/**
 * 找出所有装过本插件的 profile 目录。
 * @param dshHome DSH 的配置根目录
 * @param name 插件包名
 */
function findInstalls(dshHome, name) {
  const profilesDir = path.join(dshHome, 'profiles')
  if (!fs.existsSync(profilesDir)) return []
  const installs = []
  for (const profile of fs.readdirSync(profilesDir)) {
    const target = path.join(profilesDir, profile, 'node_modules', name)
    const manifest = path.join(target, 'package.json')
    if (!fs.existsSync(manifest)) continue
    installs.push({ profile, dir: target })
  }
  return installs
}

/** 读一个包的 package.json。 */
function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 覆盖式同步：先删掉清单里的旧条目，再整份拷过去。
 * 只碰 files 清单 + package.json，目录里的 node_modules 之类原样留着。
 */
function syncInto(source, target, files) {
  const entries = [...new Set([...files, 'package.json'])]
  for (const entry of entries) {
    const from = path.join(source, entry)
    const to = path.join(target, entry)
    if (!fs.existsSync(from)) continue
    fs.rmSync(to, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.cpSync(from, to, { recursive: true })
  }
  return entries.filter((entry) => fs.existsSync(path.join(source, entry)))
}

const args = parseArgs(process.argv.slice(2))
const source = readManifest(ROOT)
if (!source) {
  console.error(`读不到 ${path.join(ROOT, 'package.json')}`)
  process.exit(1)
}

const files = Array.isArray(source.files) ? source.files : []
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let installs = findInstalls(dshHome, source.name)
if (args.profile) installs = installs.filter((item) => item.profile === args.profile)

if (installs.length === 0) {
  console.log(`没在 ${path.join(dshHome, 'profiles')} 下找到已装的 ${source.name}。`)
  console.log('先用 dsh plugin --profile <名字> add 装一次，之后这个脚本就能替你更新。')
  process.exit(0)
}

console.log(`源码版本 ${source.version}（${ROOT}）`)
let changed = 0
for (const item of installs) {
  const installed = readManifest(item.dir)
  const before = installed?.version ?? '(未知)'
  const same = before === source.version
  const dir = path.relative(dshHome, item.dir)

  if (args.check) {
    console.log(`  ${item.profile}: ${before} ${same ? '已是最新' : `→ 可更新到 ${source.version}`}  ${dir}`)
    if (!same) changed += 1
    continue
  }

  const written = syncInto(ROOT, item.dir, files)
  const after = readManifest(item.dir)?.version ?? '(未知)'
  console.log(`  ${item.profile}: ${before} → ${after}  写入 ${written.length} 项  ${dir}`)
  changed += 1
}

if (args.check) {
  console.log(changed === 0 ? '全部已是最新。' : `${changed} 个 profile 需要更新。`)
} else if (changed > 0) {
  console.log('')
  console.log('配置不用重填：令牌/项目 ID 在 DSH_HOME/tapd/config.json，本次没动。')
  console.log('要让新代码生效，重启 DSH（或重新加载窗口）即可。')
}
