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
| 个人访问令牌 | `apiToken` | 自己用，最快。TAPD 个人设置 → 个人访问令牌 |
| 开放应用 ID / 秘钥（Basic Auth） | `apiUser` + `apiPassword` | 团队分发、需要按应用控权限 |

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

侧栏 **TAPD** → 搜标题、点开看详情 → 「复制引用」把 `@tapd:story:<id>` 拿进剪贴板，粘进输入框即用。

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

写操作在工具描述里要求模型先复述字段、拿到确认再执行。这条约束靠模型遵守，插件层没有再拦一道 —— 如果你要硬拦，在 `tools/pre-execute` 上加白名单。

## 已验证 / 未验证

写这个插件时对照的是 npm 上的实际包，不是文档示例：

- **已核实（读类型定义确认）**：`defineTool` 的 `DefineToolOptions`、`ctx.tools.register`、`agent/pre-step` 的 waterfall 形态与 `PreStepDecision = { kind: 'enter'; messages }`、`createUserMessage({ content, source })`、`MessageSource.plugin` 带 `form`/`summary`。
- **已核实（TAPD 开放平台文档）**：`GET/POST https://api.tapd.cn/stories`、`limit` 上限 200、`id` + `workspace_id` 为更新必填、返回 `{ status: 1, data, info }`、Basic Auth 用 `应用ID:应用秘钥`。
- **未验证**：在真实 DSH 例程里跑通全链路。类型是按 `@deepseek-ai/dsh-tools@0.0.1-rc.1` / `dsh-llm@0.0.1-rc.1` / `dsh-agent@0.1.0-rc.6` 核的，而 `@deepseek-ai/dsh` 本身已经到 `0.2.1-rc.2`，装到你本地后如果签名有变，`npm run typecheck` 会直接报出来。
- **已核实（读 DSH 内置包确认）**：客户端半区的模块约定 `window.__ModuleLoader__.load({ id, factory })`、`ctx.slots.register` 的 `main` / `sidebar.panellist` 两个插槽及其 `key` 对应关系、`ctx.locale.register(ns, { zh, en })` + `ctx.locale.bind(ns)`、宿主侧 `ctx.webServer.register({ kind: 'prefix', path, handler })`。浏览器半区与 `client.js` 的注册契约有冒烟测试（`npm test`）。
- **未实现**：评论、缺陷（bug）、迭代接口；从面板把引用直接塞进输入框（需要 `inputActions.setDraft`，目前是复制到剪贴板）。

## 路线

- 面板里直接「插入到对话」：`conversation.input.left`（owner 为 `InputZone`）放按钮，调 `inputActions.setDraft(draft + ' @tapd:story:... ')`。
- 补充评论 / bug / 迭代接口。

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
