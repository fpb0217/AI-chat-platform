---
title: 本地 SSE 流式 AI 对话 MVP
feature: streaming_output
status: accepted
implemented_at: 2026-08-07
accepted_at: 2026-08-07
updated_at: 2026-08-08
source_plan: ../../plan/streaming_output/local_sse_chat_mvp.md
---

# 本地 SSE 流式 AI 对话 MVP

## 验收结论

本功能已完成实现、自动化验证和用户本地实测，并于 2026-08-07 验收。用户确认核心对话与流式输出功能基本正常，并先后验收了流式代码块自动滚动，以及思考面板折叠后最终回答自动滚动两项后续修复。

源计划：[本地 SSE 流式 AI 对话 MVP](../../plan/streaming_output/local_sse_chat_mvp.md)

## 最终实现

- 前端使用 Vue 3、Vite、TypeScript 和 Tailwind CSS。
- 后端使用 Fastify、TypeScript、Drizzle ORM 和 SQLite。
- 工程使用 pnpm workspace，包含 `apps/web`、`apps/api` 和 `packages/shared`。
- 后端以原生 `fetch` 调用 DeepSeek Chat Completions API，固定使用 `deepseek-v4-flash` 并请求流式响应；MVP 初版显式关闭 thinking，后续已新增按次请求的推理强度切换。
- 浏览器通过 `fetch POST + ReadableStream` 接收业务 SSE，实现单用户、单会话的流式对话。
- 开发环境由 Vite 代理 `/api`；生产环境由 Fastify 同端口提供 API 和前端静态文件。
- 服务默认绑定 `127.0.0.1`，所有组件均在本地运行。

## 数据流与持久化

1. 前端提交用户内容至 `POST /api/chat/messages`。
2. 后端事务写入用户消息和 `streaming` 状态的 assistant 占位消息。
3. 后端将完整有效历史发送给 DeepSeek，并将上游流统一转换为业务 SSE。
4. 前端把 `delta` 放入 FIFO 队列，按 Unicode grapheme 渐进显示。
5. 正常完成、用户停止或异常时，后端将内存中聚合的正文幂等落库一次。

SQLite 启用 WAL 和外键约束。消息状态包括 `streaming`、`completed`、`stopped` 和 `error`；服务启动时会把遗留的 `streaming` 消息恢复为中断状态。空内容的失败轮次不会进入后续模型上下文，同时只允许一个生成请求。

## 配置与运行

环境要求：Node.js 24 或更高版本、pnpm 11.16。

1. 将根目录 `.env.example` 复制为 `.env`。
2. 在 `.env` 中配置 `DEEPSEEK_API_KEY`，不要使用 `VITE_` 前缀。
3. 安装依赖并初始化数据库：

   ```bash
   pnpm install
   pnpm db:migrate
   ```

4. 启动开发环境：

   ```bash
   pnpm dev
   ```

   默认前端地址为 `http://127.0.0.1:5173`，后端地址为 `http://127.0.0.1:3000`。

5. 生产模式：

   ```bash
   pnpm build
   pnpm start
   ```

   默认通过 `http://127.0.0.1:3000` 访问。

根目录还提供 `lint`、`typecheck`、`test`、`test:e2e` 和 `db:migrate` 命令。

## 公共接口

### `GET /api/health`

返回服务、数据库和模型配置状态，不返回 API Key。

### `GET /api/chat`

返回固定单例会话及按顺序排列的历史消息。

### `POST /api/chat/messages`

请求体：

```json
{ "content": "你好", "reasoningLevel": "high" }
```

`reasoningLevel` 可省略，默认是 `off`；当前可选值为 `off`、`low`、`high` 和 `max`。完整规则见 [DeepSeek 推理强度切换](../reasoning_effort_switch/deepseek_reasoning_effort_switch.md)。

响应类型为 `text/event-stream`，业务事件包括：

- `meta`：用户消息、assistant 消息 ID、模型和实际推理档位。
- `phase`：推理阶段或最终回答阶段。
- `delta`：本次新增文本。
- `done`：结束原因和 token usage，可包含 reasoning Token。
- `error`：稳定错误码、用户可读信息和 `retryable` 标记。

空白内容、超长内容、并发生成和模型未配置等情况会返回对应的稳定业务错误。浏览器断开或用户停止生成时，后端会取消上游请求，并保存已收到的部分回答。

## 前端行为

- Enter 发送，Shift+Enter 换行；输入框自动增高，最大输入长度为 20,000 字符。
- 打字机以约 48 graphemes/s 起步，积压时最高提升至约 240/s；服务端结束后在约 300ms 内排空缓冲。
- Markdown 支持 GFM、代码高亮和代码复制，并通过 DOMPurify 清洗 HTML。
- 用户接近底部时根据内容实际布局变化持续跟随，包括正在渲染的代码块和思考面板折叠后的最终回答。用户操作使底部距离增加时会优先停止抢滚动并显示“回到底部”，即使仍在距底部 96px 内也不会被新内容拉回；内容收缩仅钳制滚动位置且底部距离未增加时继续跟随。流式输出本身始终继续进行。
- 停止生成时排空已接收的显示缓冲、标记“已停止”，刷新后可从 SQLite 恢复部分回答。

## 验证结果

- ESLint：通过。
- TypeScript 类型检查：通过。
- Vitest：shared 8 项、API 20 项、Web 18 项，共 46 项通过。
- Playwright：10 项端到端测试通过，包含流式代码块持续跟随、思考折叠后的最终回答跟随和用户上滚暂停跟随三类互补回归。
- Drizzle migration 和数据库索引验证：通过。
- 生产构建、静态资源托管和健康检查冒烟测试：通过。
- 用户使用本地 DeepSeek 配置完成实测，确认核心功能基本正常。

## 相关修复

- [流式 Markdown 代码块自动滚动中断](../fixes/streaming_markdown_code_block_auto_scroll.md)：修复 Markdown 节流渲染、代码块布局增长和滚动状态判断之间的竞态，并补充用户上滚立即暂停跟随且不打断输出的后续优化。
- [思考面板折叠后最终回答自动滚动中断](../fixes/reasoning_panel_collapse_auto_scroll.md)：修复 answer 阶段内容收缩导致的滚动位置钳制被误判为用户上滚的问题。

## 后续功能

- [DeepSeek 推理强度切换](../reasoning_effort_switch/deepseek_reasoning_effort_switch.md)：新增关闭、低、高、最大四档推理强度、阶段提示和档位持久化。

## 安全说明

- `DEEPSEEK_API_KEY` 仅由后端从 `.env` 读取；`.env` 已被 Git 忽略。
- API Key 不应写入前端环境变量、浏览器存储、构建产物、日志或本文档。
- 如果密钥曾通过不可信渠道暴露，应在 DeepSeek 控制台轮换后更新本地 `.env`。

## 已知限制

- 当前只有单用户、单会话，不支持新建、重命名、删除、清空或失败重试 UI。
- 不支持用户系统、模型切换和语音输入。
- 尚未接入 RAG、MCP、Web Search 和结构化输出。
- 尚未实现虚拟列表、组件级懒加载、大规模历史分页、摘要或上下文裁剪。
- 当前仅面向本机使用，没有面向公网部署的身份认证和安全边界。
