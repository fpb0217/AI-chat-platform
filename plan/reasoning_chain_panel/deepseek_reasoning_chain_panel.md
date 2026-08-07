---
title: DeepSeek 思考过程流式展示与折叠
feature: reasoning_chain_panel
status: accepted
created_at: 2026-08-07
updated_at: 2026-08-07
---

# DeepSeek 思考过程流式展示与折叠

## 目标

在现有 DeepSeek 推理强度切换基础上，将思考模式返回的 `reasoning_content` 与最终回答严格分流：生成思考时在 assistant 回答前实时展示可展开区域，开始输出最终答案后自动折叠，完成、停止、错误及刷新恢复后仍可查看已经生成的思考过程。

产品文案统一使用“思考过程”，不把模型生成的中间文本描述为可验证、完整或真实的推理依据。

## 文档依据

方案以 2026-08-07 的 DeepSeek 官方文档为准：

- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)：思考模式在最终回答前返回 `reasoning_content`；无工具调用时，历史思考过程不需要拼入下一轮上下文。
- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)：流式响应分别使用 `delta.reasoning_content` 与 `delta.content` 返回思考过程和最终正文。
- [Thinking Mode - Tool Calls](https://api-docs.deepseek.com/guides/thinking_mode/#tool-calls)：携带 `tools` 的请求必须完整回传相关 `reasoning_content`；当前项目没有工具调用，但数据模型为后续能力保留完整内容。

## 当前基线

- `DeepSeekProvider` 已解析 `delta.reasoning_content`，但只用它发送 `phase: reasoning`，随后丢弃文本。
- 业务 SSE 通过 `phase` 区分 `reasoning` 与 `answer`，`delta` 只承载最终正文。
- 路由只累计并持久化 assistant 最终 `content`。
- SQLite 已保存推理档位和 reasoning Token，但没有保存思考文本及耗时。
- 前端只能在顶部看到“正在深度思考”，消息正文没有思考过程区域。
- 当前没有工具调用，模型历史只包含 user 输入和 assistant 最终正文。

## 已确认范围

- 仅在上游实际返回非空 `reasoning_content` 时显示思考过程，不根据档位伪造空面板。
- 新增独立的 `reasoning_delta` 业务事件；现有 `delta` 语义保持为最终回答，避免旧客户端或现有逻辑把两类内容混合。
- assistant 消息保存完整 `reasoning_content` 和服务端测量的思考阶段耗时。
- 思考开始后自动展开；进入答案阶段后自动折叠一次，之后尊重用户手动展开或收起。
- 完成、停止和错误回答均保留已经收到的部分思考内容。
- 历史消息默认折叠；关闭思考、旧消息或上游未返回思考文本时不显示区域。
- 保持现有平滑答案输出、停止生成、自动滚动、Markdown 安全渲染和移动端布局行为。
- 不加入复制思考过程、搜索、编辑、导出、用户级保存开关或工具调用。

## 共享类型与 API 契约

### 消息

`ChatMessage` 增加：

```ts
reasoningContent: string | null;
reasoningDurationMs: number | null;
```

字段语义：

- `reasoningContent === null`：旧消息、非思考模式或上游没有返回非空思考文本。
- 非空字符串：服务端已经收到的完整或部分思考过程。
- 活跃消息可在收到 reasoning 阶段后短暂使用空字符串，以便先显示“正在思考”状态；持久化时空字符串归一化为 `null`。
- `reasoningDurationMs` 从服务端收到首个 reasoning 阶段开始，到首个 answer 阶段或流终止为止；没有 reasoning 阶段时为 `null`。

### Provider 事件

增加：

```ts
{ type: "reasoning_delta"; text: string }
```

Provider 必须保证 `reasoning_content` 只产生 `reasoning_delta`，`content` 只产生现有 `delta`。即使异常上游分片同时包含两个字段，也按思考在前、答案在后的顺序分别发送，不能合并。

### 业务 SSE

新增命名事件：

```text
event: reasoning_delta
data: {"assistantMessageId":"...","text":"正在分析..."}
```

正常思考模式顺序：

```text
meta
phase(reasoning)
reasoning_delta *
phase(answer)
delta *
done
```

兼容规则：

- `phase` 继续驱动全局生成状态。
- `done` 与 `error` 增加可空 `reasoningDurationMs`，让实时消息使用服务端测量值。
- `phase(answer)` 可携带当时已经完成的 `reasoningDurationMs`，使面板在最终正文开始前即可更新标题。
- 旧客户端会忽略未知的命名 SSE 事件，现有最终答案流不受影响。
- 非思考模式、空思考流可直接从 `meta` 进入 `phase(answer)`。

## 后端设计

- Provider 对每个非空 `delta.reasoning_content` 产生 `reasoning_delta`，首次出现时仍只产生一次 `phase(reasoning)`。
- 首个非空 `delta.content` 只产生一次 `phase(answer)`；如果上游异常地在答案后又返回思考片段，不把全局阶段切回 reasoning，但仍保持内容通道隔离。
- 路由分别累计 `assistantReasoningContent` 与 `assistantContent`。
- 路由在首次 reasoning 阶段记录开始时间，在 answer 阶段、正常结束、停止、超时或异常时冻结思考耗时。
- 完成、停止和错误使用同一持久化输入保存两类内容及耗时。
- 服务端日志继续只记录稳定错误码和上游状态，不记录思考文本。

## 数据模型与迁移

为 `messages` 增加：

- `reasoning_content TEXT NULL`
- `reasoning_duration_ms INTEGER NULL`

持久化规则：

- 仅 assistant 行可能具有思考文本与耗时，user 行保持 `null`。
- 新 assistant 占位行初始为 `null`，结束时一次性写入，避免逐 token 写 SQLite。
- 停止、超时和错误都保存已经累计的部分内容。
- 旧数据迁移后保持 `null`，前端不显示虚假的空思考区域。
- 当前无工具调用，`getModelHistory()` 继续只返回 assistant 最终 `content`；思考文本不进入普通多轮上下文。

## 前端体验

- 将思考过程作为 assistant 消息中的独立折叠区域，位于最终回答之前。
- 收到 `phase(reasoning)` 时创建实时面板并自动展开；收到 `reasoning_delta` 时追加内容。
- 收到 `phase(answer)` 时更新耗时并自动折叠一次，最终答案在面板下方继续使用现有打字机输出。
- 历史消息和页面刷新恢复的面板默认折叠。
- 标题状态：
  - reasoning 阶段：“正在思考…”；
  - 已进入答案且有耗时：“已思考约 N 秒”；
  - 已完成但无耗时：“思考过程”；
  - reasoning 阶段被停止：“思考已停止”；
  - reasoning 阶段异常：“思考过程未完整生成”。
- 折叠触发器使用原生 button、`aria-expanded` 和 `aria-controls`，支持键盘和屏幕阅读器。
- 实时与历史思考文本复用经过 DOMPurify 的 Markdown 渲染；流式渲染沿用节流机制。
- 展开区域设置合理最大高度与内部滚动，移动端降低最大高度，避免超长思考过程淹没最终答案。
- 内部滚动区在用户位于底部时自动跟随最新思考内容；用户主动向上滚动后暂停跟随，重新回到底部后恢复，避免抢走阅读位置。
- 自动滚动观察值纳入 `reasoningContent`，但用户向上滚动后继续遵守现有“不抢回阅读位置”规则。

## 安全、隐私与边界

- `reasoning_content` 视为与聊天正文相同等级的敏感用户数据，只保存在本地 SQLite 和当前浏览器内存。
- 不写入服务端日志、浏览器 localStorage、分析事件或错误追踪。
- 思考文本必须经过现有 Markdown 清洗链路，不直接插入未清洗 HTML。
- 原始思考可能包含错误假设、敏感输入复述或不完整结论；UI 不把它标为事实或审计证据。
- 如果未来加入工具调用，必须扩展消息历史结构并按 DeepSeek 规则完整回传关联的 `reasoning_content`、`tool_calls` 和工具结果；本计划不实现该流程。
- 本计划不新增系统提示词，也不允许客户端提交任意上游生成参数。

## 实现顺序

1. 更新共享消息、SSE 与 Provider 事件类型。
2. 更新 Drizzle Schema、生成迁移并扩展 Repository 映射及 finalize 输入。
3. 扩展 DeepSeek Provider，严格分离 reasoning 和 answer 增量。
4. 更新聊天路由，转发 `reasoning_delta`、测量耗时并在所有结束路径持久化。
5. 更新前端流处理、自动滚动依赖和 assistant 乐观消息。
6. 实现可折叠思考过程组件、状态文案、无障碍行为与响应式样式。
7. 补齐单元、集成和 Playwright 回归，执行 lint、类型检查、全部测试和生产构建。
8. 内部验证完成后更新本计划为 `implemented_pending_acceptance`，交由用户本地验收；用户确认后再改为 `accepted` 并生成 `doc/` 最终文档。

## 测试计划

### Provider

- 多个 `reasoning_content` 分片按原顺序产生 `reasoning_delta`。
- 思考分片不混入最终 `delta`，最终正文不混入思考内容。
- reasoning/answer 阶段各只发送一次。
- 同一上游分片同时包含两类字段时顺序正确。
- 非思考响应、usage、HTTP 错误、取消和损坏流行为不回归。

### 路由与数据库

- SSE 包含正确的 `reasoning_delta`、阶段顺序和服务端消息 ID。
- 完成回答保存完整思考、最终正文和思考耗时。
- 停止与错误保存部分思考；空思考归一化为 `null`。
- GET `/api/chat` 可恢复历史思考内容与耗时。
- 模型历史仍不包含无工具调用轮次的思考内容。
- 旧迁移数据可读取，新字段为空时不会显示面板。

### 前端与 E2E

- 思考开始时面板自动出现并展开，内容流式增长。
- 答案开始时面板自动折叠，标题显示耗时，最终正文正常输出。
- 用户可以用鼠标和键盘反复展开、收起。
- 刷新后思考过程与耗时恢复，默认折叠。
- 停止和错误状态保留部分思考并显示正确状态文案。
- 非思考回答不出现思考面板。
- 思考内容超过内部最大高度后仍贴近最新内容；用户向上滚动时暂停跟随，回到底部后恢复。
- 超长内容、自动滚动、用户向上阅读及移动端无横向溢出行为不回归。

## 验收标准

- 选择任一思考档位后，用户可以在最终回答前看到可折叠的实时思考过程。
- 思考文本与最终答案在 Provider、SSE、前端状态和数据库中始终严格分离。
- 思考时自动展开、回答时自动折叠，用户手动操作可用且符合无障碍要求。
- 完成、停止、错误和刷新后均能保留应有的思考内容；非思考和旧消息不显示空面板。
- 普通多轮上下文不回传思考文本，现有答案生成、停止、Markdown、滚动和移动端能力不回归。
- lint、类型检查、全部 Vitest、Playwright 和生产构建通过。
- 内部验证完成后状态为 `implemented_pending_acceptance`；用户验收完成后更新为 `accepted` 并生成最终实现文档。

## 暂不包含

- 工具调用及工具调用过程中的 reasoning 回传。
- 思考过程复制、编辑、搜索、导出、分享或单独删除。
- 把原始思考转换为摘要，或对其正确性进行自动评价。
- 多模型统一 reasoning 能力协商、云端同步或多用户权限控制。
- 为超长思考过程增加虚拟列表或服务端分页。

## 实现验证

- 已在 `feat/reasoning-chain-panel` 分支完成共享契约、Provider、业务 SSE、SQLite、Vue 流状态及折叠 UI 的端到端实现。
- 业务流新增独立 `reasoning_delta`；DeepSeek `reasoning_content` 与最终 `content` 在 Provider、路由累计、浏览器消息状态和数据库字段中保持分离。
- Drizzle 已生成 `0002_sad_microchip.sql`，为 `messages` 增加 `reasoning_content` 和 `reasoning_duration_ms`；旧行保持 `null`。
- 完成、停止、错误和客户端断开路径均保存已收到的思考内容及服务端耗时；空思考在服务端持久化和前端终态均归一化为 `null`。
- 前端实现思考时自动展开、进入回答时自动折叠、历史默认折叠、手动切换、状态与耗时文案、Markdown 清洗渲染、响应式最大高度，以及溢出后跟随最新内容并尊重用户上滚的内部滚动策略。
- 验收前体验检查复现了长思考区静止问题：修复前在持续生成时距离底部 `1241px`；加入内容尺寸观察和显式 `scrollTop` 管理后，在禁用浏览器隐式滚动锚定的 Playwright 场景中仍能保持底部距离不超过 `1px`。
- E2E fixture 改用独立的 3100 API 端口及 Vite `e2e` 模式代理，浏览器测试可与正在运行的 3000 开发 API 并行执行。
- ESLint：通过，无错误或警告。
- TypeScript：shared、API、Web 和 E2E 类型检查全部通过。
- Vitest：shared 8 项、API 20 项、Web 18 项，共 46 项通过。
- Playwright：流式回答、思考展开/折叠/刷新恢复、思考阶段停止、长思考内部滚动、答案阶段停止、错误、自动滚动、用户阅读位置和移动端，共 9 项通过。
- 生产构建：shared、Vue 前端和 Fastify API 全部通过。
- 内部自动化未额外调用真实 DeepSeek API 或消耗账户额度；上游分片契约由 DeepSeek Provider 测试覆盖，用户随后完成本地功能测试并确认验收。

## 修订记录

- 2026-08-07：依据 DeepSeek 官方思考模式文档和当前代码基线形成计划；用户确认创建 feat 分支、按计划实施并在内部验证后交由用户验收，状态设为 `implementing`。
- 2026-08-07：功能实现及自动化验证完成，状态更新为 `implemented_pending_acceptance`，等待用户使用真实 DeepSeek 配置完成最终验收。
- 2026-08-07：验收前确认并修复超长思考内容只增长滚动条、内部视口不跟随的问题；新增显式贴底、用户上滚暂停及回到底部恢复逻辑，并补充组件与 Playwright 回归。
- 2026-08-07：用户完成本地测试并确认验收，状态更新为 `accepted`，生成 `doc/reasoning_chain_panel/` 最终实现文档。
