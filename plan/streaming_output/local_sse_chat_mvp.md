---
title: 本地 SSE 流式 AI 对话 MVP
feature: streaming_output
status: accepted
created_at: 2026-08-07
updated_at: 2026-08-07
---

# 本地 SSE 流式 AI 对话 MVP

## 目标

从空仓库实现一个本地单用户、单会话的全栈 AI 对话 MVP。前端使用 Vue 3、TypeScript 与 Tailwind CSS，后端使用 Fastify、TypeScript、Drizzle ORM 与 SQLite，通过 DeepSeek SSE 流实现平滑打字机输出。

## 已确认范围

- `pnpm` workspace：`apps/web`、`apps/api`、`packages/shared`。
- 默认模型为 `deepseek-v4-flash`，显式使用非思考模式。
- 单例会话、多轮历史持久化、Markdown 与代码块、停止生成并保留部分回答。
- 开发环境由 Vite 代理 `/api`，生产构建由 Fastify 托管前端静态资源。
- DeepSeek API Key 只存在后端环境变量，不进入浏览器或仓库。

## 数据与流生命周期

- SQLite 使用 WAL、外键和版本化迁移。
- 会话保存单例记录；消息保存 UUID、轮次、顺序、角色、正文、状态、模型、结束原因、usage 和时间戳。
- 用户消息与 assistant 占位消息在调用模型前事务写入。
- 流式正文只在内存聚合，完成、停止或失败时统一落库。
- 下游断开会取消上游请求；已有正文保存为 `stopped`。
- 服务启动时将遗留的 `streaming` 消息恢复为中断状态。

## API 契约

- `GET /api/health`：返回服务、数据库和模型配置状态。
- `GET /api/chat`：返回单例会话及有序历史。
- `POST /api/chat/messages`：接收 `{ content }` 并返回命名 SSE：`meta`、`delta`、`done`、`error`。
- 同一时间只允许一个生成请求；MVP 不允许浏览器覆盖模型、thinking 或 system prompt。

## 前端体验

- 响应式单页聊天、Enter 发送、Shift+Enter 换行、发送/停止切换。
- delta 进入 grapheme 队列，以约 48 graphemes/s 输出，积压时最高约 240/s，结束后 300ms 内排空。
- 支持经清洗的 GFM、代码高亮与复制；自动滚动根据内容实际布局变化持续跟随，用户任何实际向上滚动都会立即暂停跟随，但不会停止正在进行的流式输出。
- 刷新恢复历史；停止或失败状态随消息持久化。

## 验收标准

- lint、类型检查、单元测试、Playwright 和生产构建全部通过。
- 模拟上游覆盖分片、keep-alive、结束标记、异常和取消。
- 提供真实 Key 后完成 DeepSeek 冒烟测试，并确认 Key 不出现在客户端资产、请求和本地存储中。
- 内部验证完成后状态改为 `implemented_pending_acceptance`；用户确认后才创建对应 `doc/` 文档。

## 暂不包含

- 会话管理、失败重试、用户系统、模型切换、推理强度、语音输入。
- RAG、MCP、Web Search、结构化输出。
- 虚拟列表、懒加载与大规模上下文治理。

## 实现验证

- ESLint、前后端及 E2E TypeScript 类型检查通过。
- Vitest：shared 8 项、API 19 项、Web 13 项，共 40 项单元与集成测试通过。
- Playwright：渐进输出与刷新恢复、推理强度恢复、停止并保留部分回答、规范化错误态、流式代码块自动跟随、用户上滚暂停跟随、移动端无横向溢出，共 7 项通过。
- Drizzle 迁移可在本地 SQLite 执行；消息历史查询确认使用 `idx_messages_conversation_position` 索引。
- 前后端生产构建通过；生产服务健康接口和 Vue 静态页面冒烟测试通过。
- 用户已使用本地 DeepSeek 配置完成实际测试，确认核心对话与流式输出功能基本正常；API Key 未写入仓库或客户端配置。
- 用户已确认验收，并已创建 `doc/streaming_output/local_sse_chat_mvp.md`。
- 流式 Markdown 代码块导致自动滚动中断的问题已完成修复、自动化验证和用户验收，详见 [`doc/fixes/streaming_markdown_code_block_auto_scroll.md`](../../doc/fixes/streaming_markdown_code_block_auto_scroll.md)。
- 自动滚动判定已进一步优化：向上滚动的优先级高于 96px 底部恢复阈值，即使用户正在阅读当前回答已渲染的部分，也会立即暂停跟随而不取消流式请求。

## 修订记录

- 2026-08-07：确认 Fastify + Drizzle、单会话最小 MVP、V4 Flash 非思考、平滑字符缓冲、停止保留部分回答及 Markdown/代码块。
- 2026-08-07：新增 plan/doc 分类、单一主文件与验收后生成独立文档的生命周期规则。
- 2026-08-07：完成 MVP 实现及无真实 Key 的自动化验证，状态更新为 `implemented_pending_acceptance`。
- 2026-08-07：用户完成本地实测并确认核心功能，状态更新为 `accepted`，生成最终实现文档。
- 2026-08-07：修复流式 Markdown 代码块渲染期间自动滚动中断的问题，新增布局变化跟随机制和 Playwright 回归测试，并通过用户验收。
- 2026-08-07：优化用户上滚判定优先级，确保底部附近上滚也会立即暂停自动跟随，同时保持流式输出继续进行；新增对应 Playwright 回归测试。
