# tapd-in-dsh

DeepSeek Harness（DSH）插件：把 TAPD 需求接进会话。

三件事：

1. **左侧 TAPD 面板** —— 装完侧栏多一个入口，第一次进去填项目 ID 与访问令牌，之后直接搜需求、看详情、复制引用。
2. **注册工具** —— 模型可以查询需求列表、读需求详情、改需求状态/处理人/优先级。
3. **引用展开** —— 在输入框里写 `@tapd:story:<需求ID>`，发送时宿主自动把该需求正文注入上下文，模型不用再调一次工具。

> 面板与工具共用同一份配置：面板保存的 `$DSH_HOME/tapd/config.json` 优先，其次是插件行 config，最后是环境变量。

> 当前版本 0.2.0：宿主半区（工具 + 引用注入 + `/tapd` 本地接口）和浏览器半区（左侧 TAPD 面板）都在。

## 装完是什么体验

1. 侧栏多一个 **TAPD** 入口；
2. 第一次点进去停在配置页，填项目 ID + 个人访问令牌 → 保存（可先点「测试连接」）；
3. 配好就直接进需求列表：搜索、点开看详情、一键复制 `@tapd:story:<id>` 引用；
4. 把引用粘进输入框发出去，宿主会把需求正文注入上下文。

## 安装

插件装进 **profile**：桌面端是 `desktop`，`dsh web` 启动的浏览器端是 `web`。

`lib/`（编译产物）随仓库一起提交，所以**从 Git 装不需要在本地跑构建**，也不会触发 pnpm 的 `allowBuilds` 拦截。

> 只有改源码的开发场景才需要装依赖并重新构建：`npm install && npm run build`（记得把 `lib/` 一起提交）。

### 方式一：桌面端图形界面（推荐）

1. 侧栏 → **插件** → **添加插件**；
2. 输入框里填本地绝对路径（如 `/Users/fen/PROJECT/tapd-in-dsh`）或 Git 地址（`https://github.com/fenlgy/tapd-in-dsh`）；
3. 装完在「已安装插件」里启用，回到侧栏就能看到 **TAPD** 入口。

### 方式二：命令行

桌面端自带的 `dsh` 命令默认不在 PATH 里，先建一次软链：

```bash
sudo ln -sf "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" /usr/local/bin/dsh
```

```bash
# 本地目录安装（改完代码重新 build 即生效）
dsh plugin --profile desktop add link:/Users/fen/PROJECT/tapd-in-dsh

# 从 GitHub 安装（lib/ 已预构建，无需任何脚本）
dsh plugin --profile desktop add github:fenlgy/tapd-in-dsh

# 从 npm 安装（发布之后）
dsh plugin --profile desktop add tapd-in-dsh
```

两个坑：

- `--profile desktop` 要求**先完全退出桌面端**（它独占这个 profile 的包管理）；`--profile web` 不受影响。
- 0.2.0 及更早的版本在 `package.json` 里带 `prepare` 脚本，从 Git 装会被 pnpm 的供应链策略拦下（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）。0.2.1 起 `lib/` 预构建入库、脚本已移除，**不再需要配置 `allowBuilds`**。若你的 profile 里残留过该项，可以删掉。

确认装上了：

```bash
dsh --profile desktop --dump-config | grep -A3 tapd
```

## 配置

最省事：在左侧 **TAPD 面板 → 设置** 里填，保存后立即生效，写进 `$DSH_HOME/tapd/config.json`（权限 600）。

### 先自检，再进插件（强烈建议）

插件装上了但连不通时，用这个脚本把「凭据问题」和「插件问题」分开，它不依赖 DSH 宿主：

```bash
npm run check -- --token=你的个人访问令牌 --workspace=10104801
```

正常时输出：

```
[1/3] 参数检查
  ✓ 令牌与项目 ID 都已提供

[2/3] 拉取需求（limit=1）
  ✓ 鉴权通过，读到需求：1130000000000000001 某某需求
  · 引用写法：@tapd:story:1130000000000000001

[3/3] 读取需求详情（引用 @tapd:story: 展开时用的接口）
  ✓ 详情接口正常，正文字符数 186
```

失败时会直接告诉你该去哪儿改，例如：

```
✗ TAPD 返回 HTTP 422：The access token provided is invalid（个人访问令牌无效或已过期，去 TAPD「个人设置」重新生成）
```

客户报错时让他跑这一条把输出贴回来，就能立刻定位是哪一层的问题。

要写进 profile 也可以，面板里的值仍然优先：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: tapd
  config:
    apiToken: '你的 TAPD 个人访问令牌'
    workspaceId: '10104801'
```

或者用环境变量（适合本机临时试）：

```bash
export TAPD_API_TOKEN=...
export TAPD_WORKSPACE_ID=10104801
```

优先级：**面板保存的 config.json → 插件行 config → 环境变量**。

### 两种鉴权方式，二选一

| 方式 | 字段 | 适用 |
|---|---|---|
| 个人访问令牌 | `apiToken` | **免费版用这个**。自己用最快，TAPD 右上角头像 → 个人设置 → 个人访问令牌 |
| 开放应用 ID / 秘钥（Basic Auth） | `apiUser` + `apiPassword` | 付费版、团队分发、需要按应用控权限 |

关于 TAPD 版本的常见误区，官方口径是：

- **「API 账号」是商业化模块**（`open.tapd.cn` 使用必读：企业版管理员可在「公司管理 → 开放集成 → API 账号管理」申请试用 90 天）——免费版确实没有
- **但「个人令牌」免费企业就有**：`tapd.cn/help` 写明「免费企业：2000 次 api 调用/天」，管理员可在「公司管理 → 开放集成 → 个人令牌管理」管范围，且个人令牌不受项目级字段/工作流权限管控

所以免费版**不需要**买 API 账号也能用本插件，走个人访问令牌即可，注意每天 2000 次的额度。

Basic Auth 优先：`apiUser` 和 `apiPassword` 同时存在时用 Basic，否则用 `apiToken`。

### 全部配置项

| 字段 | 默认值 | 说明 |
|---|---|---|
| `apiToken` | — | 个人访问令牌，Bearer |
| `apiUser` / `apiPassword` | — | 开放应用 ID / 秘钥，Basic |
| `workspaceId` | — | 默认项目 ID，单项目使用时只配这里 |
| `baseUrl` | `https://api.tapd.cn` | 私有化部署改这里 |
| `timeoutMs` | `15000` | 单次请求超时 |
| `injectReference` | `true` | 是否展开 `@tapd` 引用 |
| `maxReferences` | `5` | 单轮最多展开几个引用 |
| `maxBodyChars` | `8000` | 单条需求描述注入上限 |

## 用法

### 面板

侧栏 **TAPD** → 按标题搜、按状态 / 处理人 / 迭代筛 → 点开看详情。

- 列表上方是三个下拉框，选项来自 TAPD 本身（`workflows/status_map`、`iterations`、`workspaces/users`），换条件立刻重查，不用再点刷新；标题右侧显示「共 N 条」，底部是「加载更多」（每页 20 条）。
- 每行右侧有个「插入」按钮（悬停变亮）：点了会把 `@tapd:story:<id>` 写进当前会话输入框的**光标处**，不用切窗口粘贴。拿不到输入框句柄时（没有打开会话 / 老版本宿主）自动退回复制，并提示已复制。
- 详情页右上角也有「插入到对话」，旁边是「复制引用」「复制 ID」「在 TAPD 打开」。

### 界面

面板不另起一套皮肤，直接贴着宿主的设计系统走：

- 颜色 / 圆角 / 字号全部取宿主的 `--dsw-*` 设计令牌，宿主切明暗主题时自动跟着变；
- 页面骨架照宿主设置页的量法：内容列 960px、标题 20/28 500、说明 13/20、卡片圆角 `--dsw-radius-xl`；
- 按钮尺寸与宿主一致（md 36px / sm 28px），设置项左边标签说明、右边控件；
- macOS 上顶栏用 `--dsh-frame-top-clearance` 让开窗口按钮。

样式是插件自己注入的一块 `<style data-tapd-css="tapd-in-dsh">`，插件卸载时整块移除，类名统一 `tapd-` 前缀，不碰宿主 CSS。

### 引用需求

在输入框里写引用 token，和普通文字混着写就行：

```
帮我拆一下 @tapd:story:1010104801855983211 这个需求的测试点
```

跨项目时带上项目 ID：

```
@tapd:story:10104801/1010104801855983211
```

引用是**普通文本**，随时可以手动删。发送时宿主调 TAPD 取回需求，追加一条 `plugin` 来源的上下文消息，里面是标题、状态、处理人、优先级、迭代、链接和描述正文。

### 工具

| 工具 | 用途 |
|---|---|
| `tapd_list_stories` | 按标题/处理人/状态/迭代查需求，每条附带可粘贴的引用 token |
| `tapd_get_story` | 读单个需求全文 |
| `tapd_update_story` | 改状态 / 处理人 / 优先级（写操作） |
| `tapd_create_story` | 新建需求（写操作） |
| `tapd_add_comment` | 给需求加评论（写操作） |
| `tapd_list_comments` | 读需求的评论 |

三个写操作在工具描述里都要求模型先复述字段、拿到确认再执行。这条约束靠模型遵守，插件层没有再拦一道 —— 如果你要硬拦，在 `tools/pre-execute` 上加白名单。

**写操作需要额外权限。** 个人访问令牌默认能读不一定能写：实测同一个令牌查需求正常，调 `stories/add`、`stories/update`、`comments/add` 会返回

```
403 user 582323776 doesn't have permission stories::add of workspace 40008871
```

插件会把这句话翻成人话，指出缺的是哪个权限点。要真正提单 / 评论 / 改状态，去 TAPD 项目 → 项目设置 → 成员与权限，给这个账号开 `stories::add` / `stories::update` / `comments::add`，或者改用有写权限的 API 账号。

## 面板保存不了 / 测试连接没反应？

0.2.5 修掉了这个坑，症状是：填了令牌和项目 ID，点「保存」后表单又弹回来、令牌框被清空，点「测试连接」什么都不显示。

原因是面板把请求打到了 `__DSH_TRANSPORT__.streamBaseUrl`（`http://127.0.0.1:<端口>`，宿主监听地址）。桌面端的界面跑在 `dsh-app://app` 这个自定义源上，只有**同源**请求才会被 Electron 主进程带上会话 cookie 转发给宿主；直连 `http://127.0.0.1:<端口>` 属于跨源，宿主侧既没有 CORS 头也没有 cookie，浏览器直接拦掉，前端只会看到 `Failed to fetch`。

现在改成以页面自身的 origin 为基准拼请求地址：

- 桌面端 → `dsh-app://app/tapd/...`（主进程转发 + 带 cookie）
- Web 端 → `http://<宿主>:<端口>/tapd/...`（本来同源）

另外「测试连接」现在会把表单里**还没保存**的值一起带去探活，不必先保存再测。

已经装过旧版本的，重装一次即可（图形界面里删掉再按 Git 地址装，或 `dsh plugin --profile desktop update tapd-in-dsh`）。

## 已验证 / 未验证

写这个插件时对照的是 npm 上的实际包，不是文档示例：

- **已核实（读类型定义确认）**：`defineTool` 的 `DefineToolOptions`、`ctx.tools.register`、`agent/pre-step` 的 waterfall 形态与 `PreStepDecision = { kind: 'enter'; messages }`、`createUserMessage({ content, source })`、`MessageSource.plugin` 带 `form`/`summary`。
- **已核实（TAPD 开放平台文档）**：`GET/POST https://api.tapd.cn/stories`、`limit` 上限 200、`id` + `workspace_id` 为更新必填、返回 `{ status: 1, data, info }`、Basic Auth 用 `应用ID:应用秘钥`。
- **未验证**：在真实 DSH 例程里跑通全链路。类型是按 `@deepseek-ai/dsh-tools@0.0.1-rc.1` / `dsh-llm@0.0.1-rc.1` / `dsh-agent@0.1.0-rc.6` 核的，而 `@deepseek-ai/dsh` 本身已经到 `0.2.1-rc.2`，装到你本地后如果签名有变，`npm run typecheck` 会直接报出来。
- **已核实（读 DSH 内置包确认）**：客户端半区的模块约定 `window.__ModuleLoader__.load({ id, factory })`、`ctx.slots.register` 的 `main` / `sidebar.panellist` 两个插槽及其 `key` 对应关系、`ctx.locale.register(ns, { zh, en })` + `ctx.locale.bind(ns)`、宿主侧 `ctx.webServer.register({ kind: 'prefix', path, handler })`。浏览器半区与 `client.js` 的注册契约有冒烟测试（`npm test`）。
- **已核实（读 `dsh-client-ui-conversation` 确认）**：`conversation.input.left` 是 `{ kind: 'list', scope: 'session' }` 的插槽；宿主的输入框动作面是 `captureInsertion()` + `insertText(text, span)`（不是只能整段 `setDraft`），所以「插入到对话」能落在光标处而不是覆盖草稿。拿不到 `inputActions` 时插件退回复制。
- **未实现**：缺陷（bug）接口；面板里直接新建需求（目前只给工具，不进面板）。

## 路线

- 缺陷（bug）与迭代表单：`/bugs` 与 `/iterations` 的写侧。
- 面板里直接新建需求：把 `tapd_create_story` 的字段搬成一张表单。
- 评论折叠进详情页（现在详情只放描述，评论走工具）。

## 开发

```bash
npm install           # 仓库带了 .npmrc，走 legacy-peer-deps
npm run typecheck     # 只检查类型
npm run build         # 产出 lib/
npm test              # 宿主路由 + 客户端注册契约的冒烟测试
```

> `client.js` 是手写的浏览器半区，不走构建：DSH 的客户端加载器按 `window.__ModuleLoader__.load({ id, factory })` 取模块，`factory` 返回 `{ inject, apply }`，`require` 只解析宿主已提供的裸模块（`react`）。改完刷新页面即可，不用重新 build。

> DSH 的 rc 包 peer 依赖图还没收敛，不加 `legacy-peer-deps` 会 ERESOLVE 报错，所以仓库里放了 `.npmrc`。这个文件不进 npm 包（`files` 白名单）。

本地挂载开发（改完不用打包）：

```bash
dsh plugin --profile web add link:$PWD
```

### 更新已装的 profile，不用卸载重装

装进 profile 的是 GitHub tarball 的一份拷贝，改完代码要么重新 `dsh plugin add`，要么把产物同步过去。走网络那步又慢又容易卡（拉 codeload 需要出网），所以带了个本地同步：

```bash
npm run build            # 先确保 lib/ 是新的
npm run sync:install     # 覆盖进所有装了本插件的 profile
npm run sync:check       # 只看版本差，不写盘
```

它会按 `package.json` 的 `files` 清单覆盖 `~/.dsh/profiles/*/node_modules/tapd-in-dsh`，**不碰配置**：令牌、项目 ID 都在 `~/.dsh/tapd/config.json`（可用 `DSH_HOME` 改根目录），所以不用重填。改完重启 DSH 生效。

提交后一条命令做完（构建 + 测试 + 覆盖已装目录）：

```bash
npm run after-commit
```

仓库里的 `AGENTS.md` 把这条写成了硬规则，在本仓库里工作的助手每次提交后都会自动执行。


同步让已装目录的版本比 `pnpm-lock.yaml` 里记的新——这只影响「以后是否又要重新拉一次」，下次从图形界面或 pnpm 更新时会重新对齐到推送过的那份，行为一致。

源码挂载调试（官方 scratch 流程）：

```yaml
# scratch.yml
- insert:
    - id: tapd-dev
      name: '/绝对路径/tapd-in-dsh/src/index.ts'
```

```bash
dsh web --patch ./scratch.yml
```

注意：`--patch` 里 `name` 必须是绝对路径；改完要重启，overlay 不热更。

## License

MIT
