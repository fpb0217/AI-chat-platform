---
title: 消息 Token 用量展示
feature: message_token_usage
status: accepted
implemented_at: 2026-08-11
accepted_at: 2026-08-11
updated_at: 2026-08-11
source_plan: ../../plan/message_token_usage/message_token_usage.md
---

# 消息 Token 用量展示

## 验收结论

聊天消息现在展示 DeepSeek API 返回的实际 Token 用量。每轮 user 消息显示完整实际输入 Token；assistant 消息显示最终正文 Token；推理模式额外显示思考 Token。所有数值都来自上游最终 `usage`，不会以字符数或本地 tokenizer 生成近似值。

源计划：[消息 Token 用量展示](../../plan/message_token_usage/message_token_usage.md)

## 使用方式

1. 发送一条消息后，user 与 assistant footer 会先显示“计算中…”。
2. DeepSeek 返回最终 usage 后，user 显示“实际输入 N”，assistant 显示“正文 N”。实际输入的提示说明其包含历史上下文与模型输入开销。
3. 在低、高或最大推理档位下，assistant 同时显示“思考 N”和“正文 N”；正文严格为 `completion_tokens - reasoning_tokens`。
4. `reasoning_tokens = 0` 会明确显示为 `0`。推理开启但上游缺少 reasoning 拆分时，思考和正文显示 `—`，但仍会保留 user 已确认的实际输入值。
5. 停止、断流、超时、错误或旧消息没有可信 usage 时，相关指标显示 `—`。刷新页面或切换会话后，已持久化的数值会从 SQLite 恢复。

## 最终实现

### 上游 usage 与安全校验

`DeepSeekProvider` 的流式请求继续使用 `stream_options: { include_usage: true }`。Provider 只接受满足以下条件的 usage：

- `prompt_tokens`、`completion_tokens`、`total_tokens` 都是非负安全整数，且 `total_tokens = prompt_tokens + completion_tokens`。
- 可选的 `completion_tokens_details.reasoning_tokens` 是非负安全整数，且不超过 `completion_tokens`。
- 缺字段、字符串、浮点、负数、超出安全整数或不一致的拆分均视为不可用；已生成的文本流仍继续完成。

`done.usage` 沿用既有 SSE 与持久化链路。原始 usage 只保存到 assistant 行；不新增逐 Token 事件、数据库迁移、离线 tokenizer 或费用估算。

### 前端投影与派生

`apps/web/src/lib/token_usage.ts` 对当前会话消息建立轻量 turn 索引：

- assistant 直接使用自身 usage。
- user 只有在同一非空 `turnId` 恰好存在一条 user 和一条 assistant 时，才投影对应 assistant 的 `promptTokens`。
- 缺失、重复、空或乱序 `turnId` 不会退化为“取下一条消息”，从而避免跨轮误配。
- 当前消息通过 `reasoningLevel` 判断是否启用推理；旧消息仅在存在非空 `reasoningContent` 或已知 reasoning Token 时采用保守的推理判断。

思考模式需要同时具备 `completionTokens` 与 `reasoningTokens` 才能拆出正文。非推理模式一般将 completion 作为正文；若上游异常返回 reasoning Token，计算层仍会扣除它，以避免夸大正文，但界面不会渲染思考项。

### 展示、无障碍与虚拟列表

独立的 `MessageTokenUsage.vue` footer 使用 `Intl.NumberFormat` 格式化数值，并区分 pending、available 与 unavailable：

- 生成中显示“计算中…”，终态缺失数据时显示 `—` 和辅助说明“本次请求未返回 Token 用量”。
- footer 使用 `role="note"`，不使用 `aria-live` 连续播报；user 已有有效输入而 assistant 输出无法拆分时，不会被错误标注为不可用。
- footer 位于停止/错误状态胶囊之后，使用现有深浅主题变量；窄屏允许指标换行并保持右对齐。
- 虚拟列表为 footer 预留估算行高，并在 usage 到达后重新测量，因此不破坏长会话的动态高度、自动跟随、阅读位置或 Query 定位。

## 代码结构

- `apps/api/src/provider/deepseek.ts`：DeepSeek usage 数值与一致性校验。
- `apps/web/src/lib/token_usage.ts`：turn 配对、思考模式判定和 Token 派生。
- `apps/web/src/components/MessageTokenUsage.vue`：消息 footer、格式化和无障碍语义。
- `apps/web/src/components/ChatMessage.vue`、`VirtualMessageList.vue`：将派生结果接入 user 与 assistant 行。
- `apps/web/src/components/virtual_message_list.ts`、`apps/web/src/style.css`：虚拟行估算、主题和响应式布局。
- `apps/api/src/provider/deepseek.test.ts`、`apps/web/src/lib/token_usage.test.ts`、组件与 E2E 测试：覆盖正常、推理、缺失、异常、刷新与虚拟列表回归。

## 数据与兼容性

- 不修改 Drizzle Schema 或新增迁移；现有 `messages` 的 `prompt_tokens`、`completion_tokens`、`total_tokens` 和 `reasoning_tokens` 字段继续使用。
- `answerTokens` 仅在前端从原始 usage 派生，不写回 SQLite，避免重复字段漂移。
- 标题生成等独立模型请求不会写入聊天消息 usage。
- 不支持显示 `total_tokens`、缓存命中/未命中、价格、费用或会话级汇总。

## 验证结果

- ESLint：`pnpm lint` 通过。
- TypeScript：`pnpm typecheck` 通过，覆盖 shared、API、Web 与 E2E 类型检查。
- Vitest：`pnpm test` 共 118 项通过，覆盖 Provider 校验、Token 派生、footer 状态、SSE 写入与虚拟列表重测量。
- Playwright：`pnpm test:e2e` 共 18 项通过，覆盖非推理、推理、刷新恢复、停止、错误、`finish_reason=length` 以及既有滚动回归。
- 生产构建：`pnpm build` 通过。Vite 对当前约 513 kB 的单个压缩前 JavaScript chunk 给出体积提示，但不影响构建结果。
- `git diff --check`：通过。

## 已知限制

- 仅在上游返回最终可信 usage 后展示精确值；流式期间不会实时估算。
- 旧消息或未来 Provider 未提供所需 usage 时会显示 `—`，不会进行离线回填。
- 推理模式没有 `reasoning_tokens` 时无法可靠拆分正文，因此两个 assistant 输出指标保持不可用。
- 当前不提供 token 成本、配额、导出、聚合图表或缓存拆分。
