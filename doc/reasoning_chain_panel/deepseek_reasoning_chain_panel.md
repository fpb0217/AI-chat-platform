---
title: DeepSeek 思考过程流式展示与折叠
feature: reasoning_chain_panel
status: accepted
implemented_at: 2026-08-07
accepted_at: 2026-08-07
updated_at: 2026-08-08
source_plan: ../../plan/reasoning_chain_panel/deepseek_reasoning_chain_panel.md
---

# DeepSeek 思考过程流式展示与折叠

## 验收结论

本功能已完成实现、自动化验证、长内容滚动体验修复和用户本地测试，并于 2026-08-07 验收。2026-08-08 又修复并验收了思考面板自动折叠后最终回答停止跟随的问题；用户确认思考过程的实时展示、自动折叠、历史恢复及两个阶段的长内容自动跟随均符合预期。

源计划：[DeepSeek 思考过程流式展示与折叠](../../plan/reasoning_chain_panel/deepseek_reasoning_chain_panel.md)

本功能是 [DeepSeek 推理强度切换](../reasoning_effort_switch/deepseek_reasoning_effort_switch.md) 的后续演进，覆盖其中“原始推理文本不发送到浏览器、不写入 SQLite”的旧基线；当前行为以本文档为准。

## 最终实现

- DeepSeek `delta.reasoning_content` 与最终 `delta.content` 在 Provider、业务 SSE、浏览器状态和数据库中严格分离。
- 新增独立业务事件 `reasoning_delta`，现有 `delta` 继续只表示最终回答。
- 思考开始后，assistant 回答前出现“思考过程”折叠区并自动展开。
- 首个最终回答片段到达时，思考区自动折叠并显示服务端测量的思考耗时。
- 用户可以通过鼠标、触控或键盘重新展开和收起，历史消息默认折叠。
- 完成、主动停止、上游错误和客户端断开均保存已经收到的完整或部分思考内容。
- 刷新页面后，从 SQLite 恢复思考文本、耗时、回答状态和推理档位。
- 非思考模式、旧消息和上游未返回非空思考文本的消息不显示空面板。
- 超长思考过程出现内部滚动条后会自动跟随最新内容；用户主动上滚时暂停，重新回到底部后恢复。
- 思考面板自动折叠不会被主对话误判为用户上滚，最终回答会从首个片段持续跟随到底部。
- 思考内容沿用现有 Markdown 渲染与 DOMPurify 清洗链路。

产品文案使用“思考过程”，不把模型生成的中间文本描述为完整、可验证或真实的推理依据。

## 使用方式

1. 启动应用并打开聊天页面。
2. 在顶部推理强度选择器中选择低、高或最大。
3. 发送消息。
4. 模型进入思考阶段后，最终回答前会自动展开“正在思考…”区域，内容随上游流实时增加。
5. 最终回答开始时，区域自动折叠并显示“已思考约 N 秒”；点击标题可重新查看。
6. 思考内容超过区域最大高度时，内部视口默认跟随最新内容；手动向上滚动可暂停跟随，滚到底部后自动恢复。
7. 主动停止或发生错误时，已经生成的部分思考仍可查看；刷新后继续保留。

关闭推理强度或上游没有返回非空 `reasoning_content` 时，不显示思考过程区域。

## 配置与迁移

本功能没有新增环境变量，继续使用现有配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

当前默认模型 `deepseek-v4-flash` 支持思考模式。部署或更新本地数据库时执行：

```text
pnpm db:migrate
```

应用启动流程也会使用现有迁移目录处理数据库版本。旧消息迁移后新字段保持 `null`，不会显示虚假的思考区域。

## 公共接口

### 请求

继续使用现有接口：

```http
POST /api/chat/messages
Content-Type: application/json
```

```json
{
  "content": "请分析这个问题",
  "reasoningLevel": "high"
}
```

思考过程不是客户端请求参数；它只能来自服务端确认的 DeepSeek 响应。

### SSE 事件

思考模式的正常事件顺序：

```text
meta
phase(reasoning)
reasoning_delta *
phase(answer)
delta *
done
```

新增事件示例：

```text
event: reasoning_delta
data: {"assistantMessageId":"...","text":"正在分析问题..."}
```

事件语义：

- `meta`：消息 ID、turn ID、实际模型和服务端确认的推理档位。
- `phase`：`reasoning` 表示思考阶段，`answer` 表示最终回答阶段；answer 阶段可携带 `reasoningDurationMs`。
- `reasoning_delta`：仅包含思考过程的新增文本。
- `delta`：仅包含最终回答的新增文本。
- `done`：结束原因、usage 和可空 `reasoningDurationMs`。
- `error`：稳定错误信息及可空 `reasoningDurationMs`。

旧客户端会忽略未知的命名事件 `reasoning_delta`，最终回答 `delta` 的原有语义保持不变。

## 消息与数据库模型

`ChatMessage` 增加：

```ts
reasoningContent: string | null;
reasoningDurationMs: number | null;
```

Drizzle 迁移 `0002_sad_microchip.sql` 为 `messages` 增加：

- `reasoning_content TEXT NULL`
- `reasoning_duration_ms INTEGER NULL`

持久化规则：

- 仅 assistant 消息可能保存思考文本和耗时。
- 空思考在服务端和前端终态归一化为 `null`。
- 完成、停止、错误及客户端断开均保存已收到的部分内容。
- 流式期间只在内存中累计，终止时一次性写入 SQLite，避免逐 token 写库。
- `reasoningDurationMs` 从首个 reasoning 阶段开始，到首个 answer 阶段或流终止为止。

## 多轮上下文

当前项目没有工具调用。根据 DeepSeek 无工具调用的思考模式规则，后续请求的模型历史仍只包含 user 输入和 assistant 最终 `content`，不会把历史 `reasoningContent` 拼入普通多轮上下文。

如果未来请求携带 `tools`，必须重新设计消息历史，并按 DeepSeek 规则完整回传关联的 `reasoning_content`、`tool_calls` 和工具结果；只保存最终回答将不再足够。

## 前端交互与滚动

- `ReasoningPanel.vue` 管理展开状态、状态文案、耗时、无障碍属性和内部滚动。
- `aria-expanded`、`aria-controls` 和 region 语义支持键盘及屏幕阅读器。
- 思考时自动展开；answer 阶段只自动折叠一次，此后尊重用户操作。
- 桌面端最大高度为 `min(42vh, 360px)`，移动端为 `min(36vh, 280px)`。
- `ResizeObserver` 监听实际 Markdown 内容高度，用户仍位于底部时显式更新内部 `scrollTop`。
- 用户向上滚动后停止跟随，距底部 24px 以内时重新启用，避免抢走阅读位置。
- 浏览器隐式滚动锚定不是正确性的前提；关闭该能力的 Playwright 回归仍能保持贴底。
- 主对话区域同时记录 `scrollTop`、最大滚动位置和底部距离。answer 阶段折叠思考面板造成内容收缩时，只要底部距离没有增加，就把浏览器向上钳制滚动位置视为布局调整并继续跟随；用户上滚导致底部距离增加时仍立即暂停。

## 代码结构

- `packages/shared/src/index.ts`：消息字段及 `reasoning_delta`、phase、done、error 契约。
- `apps/api/src/provider/types.ts`：Provider reasoning 增量事件。
- `apps/api/src/provider/deepseek.ts`：解析和分离 `reasoning_content` 与最终 `content`。
- `apps/api/src/routes/chat.ts`：转发 SSE、累计两类内容、测量耗时并处理所有终止路径。
- `apps/api/src/db/schema.ts`、`repository.ts`：思考文本和耗时持久化。
- `apps/api/drizzle/0002_sad_microchip.sql`：数据库迁移。
- `apps/web/src/composables/use_chat.ts`：实时消息状态及两类增量处理。
- `apps/web/src/components/ReasoningPanel.vue`：折叠面板、Markdown 展示和内部滚动跟随。
- `apps/web/src/components/ChatMessage.vue`：在最终回答前装配思考面板。
- `apps/web/src/App.vue`：主对话自动滚动、内容尺寸观察，以及布局收缩与用户上滚的区分。
- `e2e/fixture_server.ts`、`e2e/chat.spec.ts`：思考流、停止、刷新和长内容滚动回归。

## 验证结果

- ESLint：通过，无错误或警告。
- TypeScript：shared、API、Web 和 E2E 全部通过。
- Vitest：shared 8 项、API 20 项、Web 18 项，共 46 项通过。
- Playwright：10 项通过，覆盖非思考、思考展开/折叠、刷新恢复、思考阶段停止、长思考内部滚动、思考折叠后的最终回答跟随、答案阶段停止、错误、主页面滚动和移动端布局。
- 长内容滚动缺陷修复前，持续生成时内部视口距离底部 `1241px`；修复后，在禁用浏览器隐式滚动锚定的测试中保持不超过 `1px`。
- 思考折叠缺陷修复前，新增场景重复 10 次全部失败，主视口距离底部约 1725–1726px；修复后重复 10 次全部通过并保持不超过 `1px`。
- Drizzle 迁移生成与内存数据库 Repository 测试：通过。
- shared、Vue 前端和 Fastify API 生产构建：通过。
- 内部自动化未额外调用真实 DeepSeek API 或消耗账户额度。
- 用户完成本地测试，并分别确认原功能及 2026-08-08 的阶段切换滚动修复验收。

## 相关修复

- [思考面板折叠后最终回答自动滚动中断](../fixes/reasoning_panel_collapse_auto_scroll.md)：记录阶段切换时布局收缩被误判为用户上滚的根因、修复和回归数据。

## 安全与隐私

- `DEEPSEEK_API_KEY` 继续只由后端读取，不进入客户端资产、请求或浏览器存储。
- 思考过程与聊天正文采用相同的本地敏感数据策略，保存在 SQLite 和当前页面内存中。
- 思考文本不写入服务端日志、localStorage、分析事件或错误追踪。
- Markdown 内容经过 DOMPurify 清洗，不直接插入未清洗的上游 HTML。
- 原始思考可能包含错误假设、敏感输入复述或不完整结论，不能作为事实或审计证据。
- 默认本地数据目录 `data/` 已加入 `.gitignore`，避免数据库及 sidecar 文件被提交。

## 已知限制

- 当前固定使用 `deepseek-v4-flash`，没有多模型 reasoning 能力协商。
- 当前没有工具调用；加入工具调用前必须实现完整 reasoning/tool history 回传。
- 思考过程不支持整段复制、编辑、搜索、导出、分享或单独删除。
- 不生成思考摘要，也不自动评价思考过程的正确性。
- 超长内容使用固定高度滚动区，尚未实现虚拟列表或服务端分页。
- 数据仅保存在本机，不支持多用户权限、云端同步或跨设备恢复。
