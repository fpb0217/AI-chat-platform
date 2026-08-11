---
title: 消息 Token 用量展示
feature: message_token_usage
status: accepted
created_at: 2026-08-11
updated_at: 2026-08-11
---

# 消息 Token 用量展示

## 目标

在每一轮对话的消息右下角展示 DeepSeek API 返回的实际 Token 用量：用户消息展示携带历史上下文后的实际输入 Token，assistant 消息展示思考 Token（仅思考模式）与最终正文 Token。

本功能只展示上游 `usage` 中可验证的实际计数，不使用字符数换算或离线 tokenizer 生成近似值；当上游没有返回足够数据时，明确显示不可用，不能用估算值冒充实际用量。

界面沿用项目已有的“思考过程”产品语义，使用“思考 Token”而不是将模型生成的中间内容描述为可验证、完整或真实的思维链。

## 文档依据

方案以 2026-08-11 的 DeepSeek 官方文档为准：

- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)：`prompt_tokens` 表示完整 Prompt 的 Token 数，并等于缓存命中与未命中 Token 之和；`completion_tokens` 表示生成结果 Token 数；`completion_tokens_details.reasoning_tokens` 是 completion 中用于 reasoning 的 Token 数。
- [Chat Completions API - Streaming](https://api-docs.deepseek.com/api/create-chat-completion/)：启用 `stream_options.include_usage` 后，`[DONE]` 前会返回一个只承载完整请求 usage 的额外分片。
- [Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/)：不同模型的分词方式可能不同，每次实际处理量应以 API 响应中的 `usage` 为准。

## 当前基线

- `DeepSeekProvider` 已在流式请求中发送 `stream_options: { include_usage: true }`。
- Provider 已解析 `prompt_tokens`、`completion_tokens`、`total_tokens` 与可选的 `reasoning_tokens`，并通过 `ProviderEvent.done` 返回统一的 `TokenUsage`。
- 业务 SSE 的 `done` 事件已经携带 `usage`；前端在收到终态事件后写入乐观 assistant 消息。
- SQLite `messages` 表已存在 `prompt_tokens`、`completion_tokens`、`total_tokens` 与 `reasoning_tokens` 字段，`finalizeAssistant()` 已在完成、停止和错误路径保存当时可用的 usage。
- `ChatMessage.usage` 当前只挂在 assistant 消息上；历史消息加载时可恢复，但界面尚未展示。
- 同一轮 user 与 assistant 消息共享 `turnId`，可将 assistant 上的 `promptTokens` 安全投影到对应 user 消息。
- 当前流被用户停止、客户端断开、上游超时或异常结束时，DeepSeek 通常不会发送最终 usage；这些轮次不能得到完整实际计数。

## 展示规格与计数口径

### 按消息角色分配

一轮消息按以下方式展示，避免在 user 和 assistant 两行重复相同指标：

| 消息角色 | 右下角展示 | 示例 |
| --- | --- | --- |
| user | 本轮请求实际发送给模型的完整输入 Token | `实际输入 1,234 tokens` |
| assistant，非思考模式 | 最终正文 Token | `正文 568 tokens` |
| assistant，思考模式 | 思考 Token 与最终正文 Token | `思考 320 · 正文 248 tokens` |

`prompt_tokens` 包含本轮 user 输入、可用历史对话以及模型协议/模板产生的输入开销，不等同于当前 user 可见文字的离线分词数。上下文缓存是否命中不改变“实际输入”的展示值。

### 正文 Token 计算

DeepSeek 将 `reasoning_tokens` 定义为 `completion_tokens` 的组成部分，因此：

```text
非思考模式：answerTokens = completionTokens
思考模式：  answerTokens = completionTokens - reasoningTokens
```

规则：

- 思考模式下必须同时具有有效的 `completionTokens` 与 `reasoningTokens` 才能拆分正文。
- 思考模式明确返回 `reasoningTokens = 0` 时显示 `思考 0`，正文等于 completion。
- 思考模式缺少 `reasoningTokens` 时，思考和正文都显示不可用；不能把整个 completion 错标为正文。
- 非思考模式不显示“思考”项，正文直接使用有效的 completion。
- 如果上游意外在关闭思考时返回大于零的 reasoning Token，计算层仍扣除它，避免夸大正文；同时将该情况视为上游契约异常并纳入测试。
- `totalTokens` 继续保留用于数据完整性检查，但本期不在消息右下角展示。

### 思考模式判定

优先使用 assistant 消息的 `reasoningLevel`：

- `reasoningLevel === "off"`：非思考模式。
- `low`、`high`、`max`：思考模式。
- 旧消息的 `reasoningLevel` 为 `null` 时，若存在非空 `reasoningContent` 或非空 `reasoningTokens`，按思考模式处理；否则视为未知，避免错误拆分 completion。

## 共享数据与派生模型

保留现有原始类型，不把正文 Token 作为新的持久化字段：

```ts
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number | null;
}
```

Web 端新增纯派生结构：

```ts
interface TurnTokenDisplay {
  inputTokens: number | null;
  reasoningTokens: number | null;
  answerTokens: number | null;
  thinkingUsed: boolean;
  state: "pending" | "available" | "unavailable";
}
```

设计约束：

- `inputTokens` 只来源于 `promptTokens`。
- `answerTokens` 每次从原始 usage 派生，不写入 SQLite，防止重复字段产生漂移。
- `null` 表示上游没有提供可信值，与有效的 `0` 严格区分。
- 格式化和状态文案只发生在展示组件，业务层保持数值或 `null`。

## 后端设计

### usage 解析加固

扩展 `parseUsage()` 的验证：

- `prompt_tokens`、`completion_tokens`、`total_tokens` 必须是非负安全整数。
- 可选 `reasoning_tokens` 若存在，也必须是非负安全整数。
- `reasoning_tokens` 不得大于 `completion_tokens`。
- JSON 缺字段、字符串、浮点数、负数、超出安全整数或不一致的 reasoning 拆分均不能产生负数或伪造值。
- usage 异常不能让已生成的回答失败；Provider 继续完成文本流，但将 usage 视为不可用。
- 不在日志中记录用户输入、思考文本或回答正文；如需记录异常，只记录稳定错误类别和字段名。

### SSE 与持久化

- 继续使用现有 `done.usage`，不新增逐 Token 计数事件。
- 实际 usage 只在 DeepSeek 返回最终 usage 分片后可用；生成过程中不对流式文本反复分词。
- 正常完成后按现有路径一次性保存 usage。
- `finish_reason` 为 `length`、`content_filter`、`tool_calls` 或其他终态时，只要 usage 合法就正常保存和展示。
- 停止、断开、超时或错误时，若没有最终 usage，数据库保持 `null`；若未来上游确实提供完整合法 usage，则允许终态保存。
- 标题生成等独立模型请求的 usage 不进入聊天消息，避免污染对应轮次。

## 数据库与兼容性

本功能预计不新增数据库迁移：

- 原始 usage 所需列已经存在。
- usage 继续只保存在 assistant 行；user 行不复制 `prompt_tokens`。
- 页面加载后通过 `turnId` 将 assistant usage 投影给对应 user 消息。
- 旧消息的 usage 字段为 `null` 时保持可读，并显示不可用状态。
- 数据库中缺失 user/assistant 任一侧、重复 `turnId` 或顺序异常时，不把其他轮次的 usage 错配过来。

## 前端设计

### Turn 配对

从当前会话消息建立以 `turnId` 为键的轻量索引：

1. assistant 消息直接使用自身 `usage`。
2. user 消息只有在找到唯一、同 `turnId` 的 assistant 时才读取其 `promptTokens`。
3. 乐观消息在收到 `meta` 前共享本地 turn ID；收到服务端 meta 后两条消息同步替换为服务端 turn ID，配对保持一致。
4. 缺失、重复或空 turn ID 时返回不可用，不能退化为“取下一条消息”。
5. 索引只依赖角色、turn ID、reasoning 档位和 usage，不读取不断增长的正文，避免流式每个字符触发全会话 Token 投影重算。

### 展示组件

新增独立 `MessageTokenUsage.vue`：

- user 气泡下方靠右显示“实际输入”。
- assistant 的思考面板、正文与停止/错误状态之后靠右显示“思考/正文”。
- 数值使用 `Intl.NumberFormat` 加入千位分隔符。
- `0` 必须显示，不能被 falsy 判断隐藏。
- 正在生成时显示“计算中…”；终态没有 usage 时显示 `—`，并通过辅助说明提示“本次请求未返回 Token 用量”。
- 不使用 `aria-live` 持续播报；终态数值只更新一次。
- 使用现有主题变量；小字号和弱化颜色仍需满足可读性。
- 窄屏允许指标换行并保持右对齐，不产生横向滚动。
- Footer 固定处于消息内容之后；assistant 的停止/错误胶囊保持在其上方，避免状态与计数互相覆盖。

### 实时与历史状态

| 场景 | user 消息 | assistant 消息 |
| --- | --- | --- |
| 正在生成 | `实际输入 计算中…` | `正文 计算中…`，思考模式额外显示 `思考 计算中…` |
| 正常完成且 usage 完整 | 显示 prompt | 显示正文；思考模式显示思考与正文 |
| 正常完成但 usage 缺失 | `实际输入 —` | 对应指标显示 `—` |
| 用户停止、断流、超时、错误 | 有合法 usage 则显示；否则 `—` | 有合法 usage 则显示；否则 `—` |
| 旧历史消息 | 有 usage 则恢复 | 无 usage 显示 `—`，不估算 |
| 思考关闭 | 正常显示输入 | 完全省略思考项 |
| 思考开启但 reasoning 缺失 | 正常显示有效输入 | 思考与正文均显示 `—` |

## 异常与边界处理

- **usage 分片缺失**：回答仍可完成，所有未知指标显示 `—`。
- **usage 到达前连接中断**：不使用已经显示的文本做近似分词。
- **异常数值**：负数、浮点数、超大数或 reasoning 大于 completion 不显示，也不通过钳制制造看似合法的数字。
- **上下文超限导致请求被拒绝**：请求没有形成可用轮次或没有 usage，遵循现有错误流程，不显示伪造计数。
- **上下文缓存**：输入展示使用完整 `prompt_tokens`，不把 cache hit 当作零输入；缓存命中/未命中拆分不在本期展示。
- **模型内部模板开销**：实际输入可能大于所有可见文字的离线 Token 之和，这是预期行为，tooltip 需要说明“包含历史上下文与模型输入开销”。
- **空正文**：若 API 返回合法 `completionTokens`，仍显示实际数值；显示内容为空不代表 Token 必然为零。
- **思考内容为空但 reasoningTokens 非零**：相信 API usage 并显示实际 reasoning Token，不从可见字符反推。
- **思考文本存在但 reasoningTokens 缺失**：无法可靠拆分 completion，两个输出指标均不可用。
- **完成原因异常**：只要 usage 合法，计数与 `finishReason` 解耦并正常显示。
- **页面刷新或会话切换**：从本地数据库恢复；不写 localStorage，不发额外网络请求。
- **长会话与虚拟列表**：新增 footer 后由现有动态行高测量重新测量；不得破坏自动跟随、历史阅读位置、Query 定位器和 DOM 挂载上限。
- **未来 Provider**：展示层只消费统一 `TokenUsage`；不假设所有 Provider 都能返回 reasoning 拆分，缺失时使用不可用语义。

## 预计涉及文件

- `apps/api/src/provider/deepseek.ts`：加固 usage 数值与拆分验证。
- `apps/api/src/provider/deepseek.test.ts`：覆盖完整、缺失和异常 usage。
- `apps/web/src/lib/token_usage.ts`：turn 配对、思考判定与正文 Token 派生纯函数。
- `apps/web/src/lib/token_usage.test.ts`：纯计算与异常边界测试。
- `apps/web/src/components/MessageTokenUsage.vue`：Token footer 展示与无障碍文案。
- `apps/web/src/components/ChatMessage.vue`：按角色挂载 footer。
- `apps/web/src/components/VirtualMessageList.vue`：构建 turn usage 投影并传给消息行。
- `apps/web/src/components/VirtualMessageList.test.ts`：配对、动态高度及流式更新回归。
- `apps/web/src/composables/use_chat.test.ts`：`done.usage` 实时写入和终态行为。
- `apps/web/src/style.css`：右对齐、主题、移动端换行与状态样式。
- `e2e/fixture_server.ts`：提供可断言的 input/completion/reasoning usage。
- `e2e/chat.spec.ts`：非思考、思考、异常与刷新恢复端到端验证。

不预计修改 Drizzle Schema、生成数据库迁移或引入 tokenizer 依赖。

## 实现顺序

1. 为 usage 合法性、思考模式判定和正文 Token 拆分建立纯函数及测试。
2. 加固 DeepSeek usage 解析，保证异常上游数据不产生负数或错误 UI。
3. 建立按 `turnId` 的前端投影，让 user 获取对应 assistant 的实际 prompt Token。
4. 实现 Token footer 组件，并接入 user 与 assistant 消息的右下角。
5. 完成 pending、available、unavailable、思考开关及旧消息文案。
6. 调整虚拟列表行高、自动跟随和移动端样式回归。
7. 补齐 Provider、Web、Repository 回归和 Playwright 场景。
8. 运行完整验证；内部实现完成后更新为 `implemented_pending_acceptance`，用户验收后更新为 `accepted` 并归档 `doc/message_token_usage/` 最终文档。

## 测试计划

### Provider

- usage-only 最终分片可正确解析并随 `done` 返回。
- thinking/off 请求保持现有参数与流事件顺序。
- reasoning 缺失时保持 `null`，不默认成 `0`。
- `0`、正常大整数和缓存相关 prompt 数不被误判。
- 缺字段、字符串、浮点数、负数、超安全整数和 reasoning 大于 completion 时 usage 不可用，正文流仍正常完成。
- `[DONE]` 前无 usage、损坏流、HTTP 错误、取消和超时行为不回归。

### 纯逻辑与组件

- 非思考：input 等于 prompt，answer 等于 completion，不渲染思考项。
- 思考：answer 等于 completion 减 reasoning。
- reasoning 为 `0` 时显示 `0`，正文保持 completion。
- 思考开启但 reasoning 缺失时不错误展示 completion 为正文。
- 旧消息的档位、reasoningContent 与 usage 组合得到保守且稳定的判定。
- user/assistant 按唯一 turn ID 配对；缺失、重复、错序和 optimistic ID 更新不会串轮。
- pending、available、unavailable、停止和错误状态文案正确。
- 千位格式、超长标签、移动端换行、键盘和辅助技术语义可用。

### 路由、持久化与 E2E

- `done.usage` 到达后 user 与 assistant footer 同时更新。
- 非思考 fixture：例如 `prompt=6`、`completion=12`，显示“实际输入 6”“正文 12”。
- 思考 fixture：例如 `prompt=6`、`completion=12`、`reasoning=5`，显示“实际输入 6”“思考 5”“正文 7”。
- 刷新页面后从 SQLite 恢复相同数值。
- 停止、错误和 usage 缺失时显示 `—`，不出现估算数字。
- `finish_reason=length` 且 usage 合法时仍显示正确数值。
- 长对话虚拟列表的挂载数量、动态行高、自动贴底、用户上滚暂停、回到底部和 Query 定位不回归。
- 深色、浅色与移动端不溢出、不遮挡消息状态和正文。

### 验证命令

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`

## 验收标准

- 每个正常完成轮次的 user 消息右下角显示 DeepSeek 返回的完整实际输入 Token。
- 每个 assistant 消息右下角显示实际正文 Token；思考模式同时显示实际思考 Token。
- 思考模式正文严格使用 `completionTokens - reasoningTokens`，不重复计算思考部分。
- 关闭思考时不显示空的思考标签；有效的 `0` 与不可用的 `—` 可明确区分。
- 生成中、完成、停止、错误、超时、刷新恢复、旧数据及异常 usage 均有稳定且不误导的表现。
- 所有展示数字均来自 DeepSeek usage；没有本地估算、负数、跨轮错配或标题请求污染。
- 新 footer 不破坏虚拟列表、滚动跟随、Query 定位、思考折叠、深浅主题和移动端布局。
- lint、类型检查、全部 Vitest、Playwright 和生产构建通过。

## 暂不包含

- 当前 user Query 自身的离线 Token 数。
- 下载或引入 DeepSeek 离线 tokenizer。
- 显示 `total_tokens`、缓存命中/未命中 Token、价格或费用估算。
- 在流式生成期间实时估算思考或正文 Token。
- 对旧消息进行离线回填或数据库批量重算。
- 会话级、用户级 Token 汇总、图表、导出、配额或告警。
- 修改上下文裁剪策略、模型请求模板或 DeepSeek 计费口径。

## 修订记录

- 2026-08-11：根据现有 DeepSeek usage 数据链路形成初始计划，明确实际输入、思考与正文 Token 的来源、拆分规则、异常降级、消息配对、UI 状态及完整测试范围；状态设为 `draft`，尚未开始实现。
- 2026-08-11：已完成 DeepSeek usage 校验、前端 turn 配对与 Token footer，并通过 lint、类型检查、全量 Vitest、Playwright 和生产构建；状态更新为 `implemented_pending_acceptance`，等待用户验收。
- 2026-08-11：用户确认按文档生命周期归档本功能并要求提交、推送；计划状态更新为 `accepted`，最终实现说明归档至 `doc/message_token_usage/`。
