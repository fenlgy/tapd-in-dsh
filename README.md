# tapd-in-dsh

DeepSeek Harness（DSH）插件：把 TAPD 需求接进会话。

两件事：

1. **注册工具** —— 模型可以查询需求列表、读需求详情、改需求状态/处理人/优先级。
2. **引用展开** —— 在输入框里写 `@tapd:story:<需求ID>`，发送时宿主自动把该需求正文注入上下文，模型不用再调一次工具。

> 当前版本 0.1.0：只含宿主半区（工具 + 引用注入），不含自定义界面。需求面板在 0.2 路线里。

## 安装

```bash
# 从 GitHub 装（推荐，方便分发）
dsh plugin --profile web add github:fenlgy/tapd-in-dsh

# 从 npm 装（发布之后）
dsh plugin --profile web add tapd-in-dsh
```

装完重启：

```bash
dsh --profile web
```

确认插件已进入配置树：

```bash
dsh --profile web --dump-config | grep -A2 tapd
```

## 配置

最少填两项：鉴权 + 项目 ID。

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
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
- **未实现**：评论、缺陷（bug）、迭代接口；自定义面板。

## 路线

- **0.2 需求面板**：注册到 `conversation.view`（`{ kind: 'list', scope: 'session' }`，owner 为 `ConvViewOwnerProps`）做一个需求列表 tab，点行调用 `inputActions.setDraft(draft + ' @tapd:story:... ')` 把引用塞进输入框。`conversation.input.left`（owner 为 `InputZone`，带 `session` / `input` 快照）可以放一个「插入需求引用」按钮。这两处签名已核实，缺的是客户端半区取数据的传输层，需要先确认宿主怎么暴露自定义 HTTP 路由。
- 补充评论 / bug / 迭代接口。

## 开发

```bash
npm install           # 仓库带了 .npmrc，走 legacy-peer-deps
npm run typecheck     # 只检查类型
npm run build         # 产出 lib/
```

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
