---
title: DeepSeek 推理强度切换
feature: reasoning_effort_switch
status: accepted
created_at: 2026-08-07
updated_at: 2026-08-07
---

# DeepSeek 推理强度切换

## 目标

在现有本地单用户、单会话聊天应用中，为 `deepseek-v4-flash` 新增按次请求生效的推理强度切换。用户可以在关闭、低、高、最大四档之间选择；后端负责校验并显式映射到 DeepSeek Chat Completions API，回答记录保存实际档位和推理 Token，用流式阶段事件避免思考期间界面看似卡住。

## 文档依据

方案以 2026-08-07 的 DeepSeek 官方文档为准：

- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)：OpenAI 格式通过 `thinking.type` 开关思考，通过 `reasoning_effort` 控制强度；`deepseek-v4-flash` 支持 `low`、`high`、`max`。
- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)：思考模式默认开启；流式响应分别通过 `delta.reasoning_content` 和 `delta.content` 返回推理与最终正文；usage 可包含 `completion_tokens_details.reasoning_tokens`。
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)：推理输出会计入生成 Token，应在界面中提示最大档位可能带来更长延迟和更高费用。

## 当前基线

- 模型固定为 `deepseek-v4-flash`。
- 浏览器发送 `{ content }`，共享请求 Schema 不包含生成参数。
- Provider 固定发送 `thinking: { type: "disabled" }`，只解析 `delta.content`。
- 业务 SSE 只有 `meta`、`delta`、`done`、`error`。
- 前端顶部模型胶囊固定展示“非思考”，生成状态只有连接、输出和排空。
- assistant 消息持久化模型、结束原因和基础 usage，未记录推理档位及推理 Token。
- 模型历史只包含 user/assistant 最终正文，当前没有工具调用。

## 已确认范围

- 产品层定义 `ReasoningLevel = "off" | "low" | "high" | "max"`。
- 默认值保持 `off`，确保旧客户端和现有用户行为、延迟及费用不发生静默变化。
- 推理档位按每次发送快照，不修改已经在生成的请求。
- 后端执行白名单校验、模型能力校验和 DeepSeek 参数映射，浏览器不能直接提交任意上游参数。
- Provider 识别推理与最终回答两个流式阶段；首版不向浏览器发送、不展示、不持久化原始 `reasoning_content`。
- 新增档位与推理 Token 持久化，历史回答可显示其实际生成档位。
- 当前选择作为本地偏好保存；服务端消息记录作为历史事实来源。
- 桌面端和移动端均可使用键盘、触控和屏幕阅读器操作选择器。

## 档位与上游映射

| 产品档位 | 界面文案 | `thinking` | `reasoning_effort` |
| --- | --- | --- | --- |
| `off` | 关闭 | `{ "type": "disabled" }` | 不发送 |
| `low` | 低 | `{ "type": "enabled" }` | `low` |
| `high` | 高 | `{ "type": "enabled" }` | `high` |
| `max` | 最大 | `{ "type": "enabled" }` | `max` |

约束：

- 每次上游请求都显式发送 `thinking`，不依赖 DeepSeek 默认值。
- `off` 时省略 `reasoning_effort`，避免开关与强度组合产生歧义。
- 不向用户暴露 `medium`、`xhigh` 等兼容别名。
- 模型能力由 Provider 声明；如果未来切换到能力不同的模型，前端隐藏不支持档位，后端仍拒绝绕过前端提交的无效档位，不做静默映射。
- 思考模式不新增 `temperature`、`top_p`、`presence_penalty` 或 `frequency_penalty` 参数。

## 共享类型与 API 契约

### 请求

`POST /api/chat/messages` 扩展为：

```json
{
  "content": "请解释这个算法",
  "reasoningLevel": "high"
}
```

- `reasoningLevel` 在输入兼容层允许省略，服务端解析后默认成 `off`。
- 不属于 `off|low|high|max` 的值返回 HTTP 400，并且必须在创建 turn 前终止。
- 当前模型不支持的合法档位返回 HTTP 400 和稳定业务错误 `UNSUPPORTED_REASONING_LEVEL`。

### 模型能力

`GET /api/health` 增加非敏感能力信息：

```json
{
  "reasoningCapabilities": {
    "levels": ["off", "low", "high", "max"],
    "defaultLevel": "off"
  }
}
```

前端以服务端能力与本地偏好的交集初始化选择；能力缺失或本地值无效时回退到 `off`。

### SSE

新增命名事件 `phase`：

```text
event: phase
data: {"assistantMessageId":"...","phase":"reasoning"}

event: phase
data: {"assistantMessageId":"...","phase":"answer"}
```

- Provider 收到首个非空 `reasoning_content` 时只上报一次 `reasoning`。
- Provider 收到首个非空 `content` 时只上报一次 `answer`，正文继续使用现有 `delta`。
- `meta` 增加服务端确认的 `model` 和 `reasoningLevel`，覆盖乐观消息中的临时值。
- `done` 沿用现有结束语义，usage 增加可空的 `reasoningTokens`。
- 未开启思考或上游未返回推理正文时，可以直接从连接进入 `answer`。

## Provider 设计

- `ChatProvider.streamChat` 改为接收包含 `signal` 与 `reasoningLevel` 的生成选项对象，避免继续增加位置参数。
- Provider 暴露当前模型支持的推理档位，路由在写库和建立 SSE 前完成能力校验。
- `DeepSeekChunk.delta` 增加可空的 `reasoning_content`。
- Provider 只将 `content` 转换成业务正文 delta；原始推理文本仅用于识别阶段，随后丢弃。
- `parseUsage` 兼容不存在 `completion_tokens_details` 的响应，并在存在时解析 `reasoning_tokens`。
- 继续复用当前 AbortSignal、超时、上游错误映射、SSE 分片解析和 `[DONE]` 完整性检查。

## 数据模型与迁移

为 `messages` 新增：

- `reasoning_level`：可空文本，枚举为 `off|low|high|max`。
- `reasoning_tokens`：可空整数。

持久化规则：

- 仅 assistant 行保存 `reasoning_level`，与现有 `model` 语义保持一致；user 行为 `null`。
- 新 turn 在调用上游前保存服务端确认的档位，因此完成、停止和错误回答都能追溯其配置。
- `reasoning_tokens` 在上游提供完整 usage 时写入，否则为 `null`。
- 旧消息迁移后两个字段保持 `null`，API 与界面隐藏未知档位，不伪造为 `off`。
- 原始 `reasoning_content` 不进入 SQLite。

## 多轮上下文

- 当前无工具调用，继续只把最终 assistant `content` 拼入后续模型历史。
- 根据 DeepSeek 官方规则，无工具调用时，上一轮 `reasoning_content` 不需要参与下一轮上下文。
- 如果后续新增工具调用，必须重新评审本决策；思考模式工具调用要求保存并完整回传相关 `reasoning_content`，不属于本计划范围。

## 前端体验

- 将顶部静态模型胶囊拆为独立的 `ReasoningSelector`，使用 button + listbox/radio 语义并支持 Escape、方向键、Enter 和点击外部关闭。
- 选项说明：关闭为快速回答；低为轻量分析；高用于复杂问题；最大为最强推理，并提示可能更慢、消耗更多 Token。
- 选择值使用版本化 localStorage key 保存；读取后必须经过共享 Schema 校验。
- `sendMessage(content, reasoningLevel)` 显式接收档位并在发送前快照，乐观 assistant 消息同步记录该档位。
- 生成期间禁用选择器，避免当前请求与下一请求的档位含义混淆。
- 流状态增加 `reasoning`；收到阶段事件后显示“正在深度思考”，收到回答阶段后恢复“正在生成”。
- assistant 作者区域可显示“DeepSeek · 高推理”等紧凑标签；旧消息没有档位时不显示。
- 移动端保留可见的紧凑档位标识和完整无障碍名称，不再直接隐藏整个模式信息。

## 兼容性与安全

- 旧请求省略 `reasoningLevel` 时保持非思考模式。
- API Key、上游请求体和原始推理内容仍只存在后端，不写入浏览器存储或日志。
- 健康接口只返回模型能力，不返回密钥或账户信息。
- 用户输入只能选择产品枚举，不能覆盖 model、system prompt、`thinking` 对象或其他 DeepSeek 参数。
- 最大档位仍受现有停止生成和服务端请求超时控制；本计划不向浏览器开放 `max_tokens` 或超时参数。

## 实现顺序

1. 在共享包增加推理档位 Schema、请求字段、消息字段、能力响应、阶段事件和 reasoning usage 类型。
2. 增加 Drizzle 字段与版本化迁移，更新 Repository 映射、创建 turn 和 finalize 逻辑。
3. 扩展 Provider 接口及 DeepSeek 请求映射、阶段识别和推理 Token 解析。
4. 在路由中完成能力校验、档位快照、SSE `phase` 转发和 `meta` 确认。
5. 实现前端能力加载、偏好保存、选择器、流状态和历史档位展示。
6. 更新 fake provider、单元/集成测试、Playwright 和项目文档。
7. 使用真实 DeepSeek API Key 完成四档冒烟验证；用户验收后在 `doc/reasoning_effort_switch/` 创建最终实现文档。

## 测试计划

### 共享契约

- 省略档位默认得到 `off`。
- 接受 `off`、`low`、`high`、`max`，拒绝未知值及兼容别名。

### Provider

- 四档分别生成准确的 DeepSeek JSON；`off` 不包含 `reasoning_effort`。
- `reasoning_content` 只触发阶段，不混入最终正文。
- 同一阶段只产生一次事件，分片边界不影响识别。
- usage 存在或缺失 reasoning details 时均能解析。
- 取消、HTTP 错误、损坏流和缺少 `[DONE]` 的现有行为不回归。

### 路由与数据库

- 路由把档位传给 Provider，并在 `meta` 返回实际档位。
- 非法或不支持的档位在创建 turn 前失败。
- 完成、停止和错误回答均保留档位；完整 usage 保存推理 Token。
- 旧迁移数据可读取，空字段不会显示成错误档位。
- 模型历史不包含原始推理内容。

### 前端与 E2E

- 选择器支持键盘、鼠标、触控、屏幕阅读器名称及生成期间禁用。
- 本地偏好合法时恢复，非法或模型不支持时回退。
- 请求体携带发送瞬间的档位，服务端 `meta` 能校正乐观状态。
- 推理阶段显示“正在深度思考”，最终正文继续平滑输出。
- 选择 `max` 后发送、完成、刷新，历史回答仍显示正确档位。
- 移动视口可以打开选择器且无横向溢出。

### 真实 API 冒烟

- 四档各发送同一条可比较提示词，确认请求成功和最终正文完整。
- 思考档位能观察到 reasoning 阶段；关闭档位不会意外进入思考阶段。
- 记录首个正文延迟、总耗时、completion tokens 和 reasoning tokens，用于确认最大档位的产品提示合理。
- 确认 API Key、上游参数和原始 reasoning content 不出现在客户端资产、浏览器存储及应用日志中。

## 验收标准

- 用户可以在四档之间选择，选择值对下一条消息准确生效。
- 默认行为仍为非思考；旧客户端和旧数据库无需人工处理即可继续工作。
- DeepSeek 请求参数与档位映射准确，非法值不能到达上游。
- 思考期间有明确状态，不出现无反馈的空白等待。
- 最终回答不包含原始推理文本，历史上下文行为保持不变。
- 每条 assistant 消息可追溯模型和推理档位，可用时保存推理 Token。
- 停止、超时、错误、刷新恢复、自动滚动和移动端布局不回归。
- lint、类型检查、全部 Vitest、Playwright、生产构建和真实 API 冒烟测试通过。
- 内部实现完成后状态更新为 `implemented_pending_acceptance`；用户确认后更新为 `accepted` 并生成最终文档。

## 实现验证

- 共享契约已覆盖省略档位默认 `off`、四个合法档位及 `medium`、`xhigh`、`turbo` 非法值。
- Drizzle 已生成 `0001_hesitant_korath.sql`，Repository 验证 assistant 档位和 reasoning Token 的创建、完成及读取。
- DeepSeek Provider 覆盖四档精确请求体、模型能力、推理/回答阶段分离、reasoning usage、HTTP 错误和损坏流。
- API 集成覆盖档位传递、`meta`/`phase` SSE、非法与模型不支持档位在写库前拒绝、完成/停止/错误持久化。
- 前端覆盖模型能力加载、本地偏好校验、档位请求快照、服务端确认、思考阶段、停止以及选择器键盘与禁用状态。
- ESLint 通过；共享包、API、Web 与 E2E TypeScript 类型检查通过。
- Vitest：shared 8 项、API 19 项、Web 13 项，共 40 项通过。
- Playwright：原有流式/停止/错误/滚动/移动端场景及新增最大推理与刷新恢复场景，共 6 项通过。
- 共享包、Vue 前端和 Fastify API 生产构建通过。
- 使用本地 DeepSeek 配置完成 `deepseek-v4-flash` 四档真实冒烟：`off` 只出现 answer 阶段且无 reasoning Token；`low`、`high`、`max` 均依次出现 reasoning/answer 阶段并返回 reasoning Token，四次均以 `stop` 正常结束。
- 冒烟测试未输出 API Key 或原始 reasoning content；浏览器和 SQLite 仍只接收阶段、最终正文、档位及 Token 统计。

## 暂不包含

- 模型切换、V4 Pro 接入或允许用户自定义模型名。
- 展示、折叠、复制或持久化原始思维链。
- 工具调用及工具调用场景下的 reasoning 回传。
- 用户级云端设置同步、跨设备偏好和多会话独立设置。
- 用户可配置 `max_tokens`、temperature、超时或推理 Token 预算。
- 按档位自动选择模型、自动路由、计费上限或配额管理。

## 修订记录

- 2026-08-07：基于 DeepSeek V4 Flash 官方 API 文档和当前项目完成方案，确认关闭/低/高/最大四档、默认关闭、后端能力校验、流式阶段提示、档位与推理 Token 持久化，以及首版不展示原始思维链。
- 2026-08-07：用户确认按计划实施，状态更新为 `implementing`。
- 2026-08-07：实现与内部验证完成，状态更新为 `implemented_pending_acceptance`，等待用户验收。
- 2026-08-07：用户完成本地测试并确认功能没有问题，状态更新为 `accepted`，生成最终实现文档。
