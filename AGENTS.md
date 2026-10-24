# tapd-in-dsh 工作规则

面向在本仓库里工作的 AI 助手。用户视角的安装/使用说明在 `README.md`，这里只写「动手时必须遵守」的约定。

## 1. 提交代码后必须同步本机已装插件

**规则：每次 `git commit` 之后（不用等用户提醒），必须把新代码同步进本机已安装的 DSH profile。**

本机安装形态是「GitHub tarball 的一份拷贝」，改完仓库不会自动生效；重装一次要过网络、还要重填令牌，所以走本地覆盖同步。

一条命令做完三件事（构建 → 测试 → 覆盖已装目录）：

```bash
npm run after-commit      # = npm run build && npm test && node scripts/sync-install.mjs
```

拆开就是：

```bash
npm run build             # lib/ 是入库产物，不重建 = 提交旧代码
npm test                  # routes / client / error 三个冒烟测试必须全绿
npm run sync:install      # 按 package.json 的 files 清单覆盖 ~/.dsh/profiles/*/node_modules/tapd-in-dsh
```

要点：

- **只改了 `client.js` 也要同步**：它不在 `lib/` 里，但同步脚本会一并拷贝。
- **同步不动配置**：令牌与项目 ID 在 `~/.dsh/tapd/config.json`（与包目录无关），覆盖不会丢，绝不能让用户重填。
- **同步完要告诉用户「重启 DSH 才生效」**：只改了 `client.js` 可以只重载窗口；动到 Node 侧（`lib/`）就完全退出再重开。
- **别用重装代替同步**：本机 GitHub HTTPS 出网被拦（`CONNECT ... 502`），`dsh plugin update` 走不通；同步是目前唯一可靠通道。
- 提交前想确认是否已对齐，用 `npm run sync:check`（只比对版本，不写盘）。
- 如果 `npm test` 挂了，**不要**同步：同步会把半成品推到用户正在用的环境里。

## 2. 版本与产物

- 行为有变化就升 `package.json` 的 `version`（语义化 `0.x.y`），并在 README 的改动说明里补一句。
- 源码在 `src/`（TypeScript），产物在 `lib/`（JavaScript）——**`lib/` 必须一起提交**，否则从 GitHub 装出来的是旧行为。
- `client.js` 是手写的浏览器半区，**不过构建**：`window.__ModuleLoader__.load({ id, factory })` 里 `require` 只允许 `react`，不引第三方库、不加打包器。
- 依赖只允许是宿主提供的 peer（`dsh-llm` / `dsh-tools` / `schemastery` / `cordis`）加 Node 内置模块。

## 3. 视觉一体化

- 颜色、圆角、字号一律用宿主 `--dsw-*` 设计令牌，**不自造色板**，明暗主题自动跟随。
- 类名统一 `tapd-` 前缀；样式用 `<style data-tapd-css="...">` 注入，卸载时移除。
- 尺寸照宿主设置页的量法：内容列 960px、标题 20/28 w500、正文 13~14/20~24、按钮 md 36 / sm 28、输入框 32px 高 `.5px` 边框。
- 改界面要留证据：用 `/tmp/tapd-preview/` 下的脚本（`build.mjs` 出静态 HTML、`dom-check2.mjs` 用 jsdom + 真 React 挂载、`shot.mjs` 截图）跑一遍，确认零 React 告警再提交。

## 4. 请求与凭据

- 浏览器半区**只打同源前缀 `/tapd`**：桌面端页面在 `dsh-app://app`，地址由 `document.baseURI` 推出；**禁止**直连 `http://127.0.0.1:<端口>`（跨源且没有 CORS 头，会被浏览器整个拦掉，历史 bug 见 0.2.5）。
- 凭据只留在 Node 侧中转，**任何响应体都不许带出令牌**（`publicConfig()` 只回 `configured` 之类派生信息）。
- 写操作（`tapd_update_story` / `tapd_create_story` / `tapd_add_comment`）保持「靠模型先向用户复述并确认」，插件层不硬拦；但工具描述里必须写明「这是写操作」。
- 遇到 403 先看 TAPD 的 `info`：`company does not match` / `not allowed to access project` / `doesn't have permission <权限点>` 是三种完全不同的原因，处置写进 `explainStatus()`，不要笼统报「无权限」。

## 5. 测试与实证

- 行为改动必须补 `test/*.smoke.mjs` 断言，`npm test` 全绿才允许提交。
- **接口形状以实测为准，不以文档为准**：改 TAPD 相关逻辑前，先用 `npm run check -- --token=... --workspace=...` 或 `curl` 打真实接口确认字段与权限，再动手。
- TAPD 描述字段是 TinyMCE 的 HTML 源码（`<div>/<p>/<img src="/tfl/...">`），图片直连会跳登录页，必须走 `files/get_image` 换签名地址——涉及正文渲染时别绕过这条。签名地址回的 `Content-Type` 是残缺的 `image`（没有子类型），要按后缀补全，否则浏览器不保证解码。
