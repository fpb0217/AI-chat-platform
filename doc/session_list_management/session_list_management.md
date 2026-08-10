---
title: 会话列表管理
feature: session_list_management
status: accepted
implemented_at: 2026-08-10
accepted_at: 2026-08-10
updated_at: 2026-08-10
source_plan: ../../plan/session_list_management/session_list_management.md
---

# 会话列表管理

## 验收结论

本功能已完成多会话持久化、会话列表、切换续聊、新对话、重命名、二次确认删除和 DeepSeek 自动标题，并于 2026-08-10 完成自动化验证与用户验收。

用户实际测试发现旧版自动标题 `Claude Code与Cod` 恰好命中 15 字素上限，无法完整表达“claude code和codex在harness工程上的区别”。根因确认是标题长度限制过于激进，而不是已证实的 DeepSeek 总结偏差。自动标题硬上限已提高至 48 个 Unicode 字素，提示词同步要求优先保留关键对象、领域和比较关系，并增加 31 字素完整标题回归测试。

源计划：[会话列表管理](../../plan/session_list_management/session_list_management.md)

## 最终实现

- SQLite 是会话和消息的唯一事实来源，浏览器只保存最后选择的会话 ID。
- 历史列表只展示非空会话，并按最近消息活动时间倒序排列。
- 新对话采用延迟创建；用户发送第一条消息时，服务端在事务中创建会话及首轮消息。
- 每个会话拥有独立消息顺序和模型历史，切换或继续对话不会混入其他会话上下文。
- 桌面端使用固定侧栏，移动端使用覆盖式抽屉；当前会话、长标题省略和键盘焦点均有明确状态。
- 会话支持中央模态框重命名，以及菜单内两次明确点击后删除。
- 当前存在生成任务时禁用切换、新建和删除，避免界面状态与服务端流式写入错位。
- 每轮可用回答结束后异步生成自动标题，标题失败不会影响聊天回答、消息持久化或下一轮发送。

## 使用方式

1. 启动应用后，左侧列表自动加载最近会话；移动端通过顶部菜单按钮打开列表。
2. 点击历史条目加载完整消息并继续对话；刷新页面后会恢复仍然有效的最后选择。
3. 点击“新对话”进入空白起始页，发送第一条消息后才创建新会话。
4. 打开条目右侧菜单可重命名；手动标题保存后不会被自动摘要覆盖。
5. 第一次点击“删除”只进入确认状态，第二次点击“确认删除”才永久删除该会话及其消息。
6. 回答生成期间如需切换、新建或删除，应先停止当前回答。

## 数据模型与迁移

Drizzle 迁移 `apps/api/drizzle/0003_dusty_wallow.sql` 为 `conversations` 增加：

- `title_source`：`auto | manual`，旧记录默认设为 `auto`。
- `title_turn_id`：记录当前自动标题所依据的 turn，用于幂等和竞态保护。
- `idx_conversations_updated_at`：支持按消息活动时间读取会话列表。

`updated_at` 表示最近消息活动时间。手动重命名和自动标题回填不更新时间，避免仅修改标题就改变列表顺序。删除会话继续依赖 SQLite 外键级联删除消息。

旧 `default` 会话保持兼容；没有消息的旧会话不会显示在列表中。默认数据库及 WAL、SHM 等 sidecar 文件位于已忽略的 `data/` 目录。

## 公共接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/conversations` | 返回不含消息正文的非空会话摘要列表。 |
| `GET` | `/api/conversations/:conversationId` | 返回指定会话及按 position 排序的完整消息。 |
| `PATCH` | `/api/conversations/:conversationId` | 保存手动标题并将来源切换为 `manual`。 |
| `DELETE` | `/api/conversations/:conversationId` | 删除会话；活动生成中的会话返回 HTTP 409。 |
| `POST` | `/api/conversations/:conversationId/auto-title` | 按最新 turn 从数据库读取问答并生成自动标题。 |
| `POST` | `/api/chat/messages` | 向指定会话追加消息，或在 `conversationId: null` 时创建新会话。 |

聊天 SSE 的 `meta` 事件增加服务端确认的 `conversationId`。前端以该值回填延迟创建的会话，客户端不能自行指定新会话 ID、自动标题正文、标题模型或 system prompt。

`GET /api/chat` 继续读取旧 `default` 会话以保持兼容，新界面使用按会话 ID 的详情接口。

## 自动标题

### 上游请求

- 固定使用 `deepseek-v4-flash`。
- 显式发送 `thinking: { "type": "disabled" }` 和 `stream: false`。
- 使用 JSON Output，只接受包含字符串 `title` 的 JSON 对象。
- 请求只包含最近一轮的用户问题和 assistant 最终回答，不包含其他历史或 `reasoning_content`。
- 问题和回答分别限制为 4,000 与 6,000 个 Unicode 字素；超限时保留开头和结尾。
- 标题建议为 20～40 个字符，硬上限为 48 个 Unicode 字素；标题请求 `max_tokens` 为 96。

### 输出边界

服务端解析 `choices[0].message.content` 后执行以下处理：

1. 只读取 `title` 字段并拒绝控制字符。
2. 折叠连续空白，移除明显的 Markdown 标题符号和成对引号。
3. 按 Unicode 字素硬截断到 48 个字符，正确处理中文、Emoji 和组合字符。
4. 上游未配置、失败、超时、返回空内容或无效 JSON 时，使用规范化后的用户问题作为确定性兜底。

标题写入前会再次确认会话仍存在、标题来源仍为 `auto`、请求 turn 仍为最新 turn。同一 turn 重复请求直接返回当前结果；手动标题不会调用上游，也不会被覆盖。

## 前端状态与交互

- `useConversations` 管理列表、活动会话、选择恢复、重命名、删除和自动标题刷新。
- localStorage key `ai-chat.active-conversation.v1` 只保存最后选择的会话 ID。
- 列表请求使用版本号防止快速切换时旧响应覆盖新状态。
- `useChat` 在发送请求中携带活动会话 ID，并从 SSE `meta` 接收新建会话 ID。
- 自动标题请求独立于主聊天 SSE；回答结束即可恢复输入，不等待标题生成。
- 条目菜单支持点击外部和 Escape 关闭；重命名模态框支持自动聚焦、Enter 保存和 Escape 取消。
- 手动标题最多 60 个 Unicode 字素；侧栏显示宽度与存储上限分离，超宽内容单行省略但保留完整可访问文本。

## 验证结果

- ESLint：通过。
- TypeScript：shared、API、Web 和 E2E 全部通过。
- Vitest：shared 11 项、API 28 项、Web 21 项，共 60 项通过。
- Playwright：完整 12 项通过，覆盖多会话创建与隔离、切换、重命名和二次确认删除，并保留流式输出、停止、错误、自动滚动及移动端回归。
- 生产构建：shared、Vue 前端和 Fastify API 全部通过。
- `git diff --check`：通过。
- 用户真实会话触发了 DeepSeek 自动标题链路；由此发现并修复旧 15 字素上限，示例的 31 字素期望标题已加入 Provider 与共享契约测试。

## 安全与隐私

- `DEEPSEEK_API_KEY`、Authorization Header 和标题请求体只存在服务端，不写入浏览器存储或接口响应。
- 列表接口不返回消息正文，详情按需加载，避免启动时传输全部聊天历史。
- 自动标题只接受服务端从 SQLite 读取的问答，不能由客户端注入原文或请求参数。
- 标题始终作为普通文本渲染，并经过字段白名单、控制字符检查、规范化和长度限制。
- 本地数据库、环境变量、构建产物、测试产物和临时检查脚本均由 `.gitignore` 排除。

## 已知限制

- 当前保持全局单一生成任务，不支持跨会话并发回答或切换后后台继续生成。
- 暂不支持账户、云同步、搜索、标签、置顶、归档、批量操作、分页或虚拟列表。
- 暂不支持手动恢复自动标题、重新摘要或标题版本历史。
- 策略升级不会批量重算既有自动标题；继续完成新一轮对话后会按最新 turn 更新。用户报告的示例旧标题已单独修正。
- 自动标题质量仍受上游模型影响；服务端只保证结构、字符安全、幂等和 48 字素上限，失败时回退到用户问题。
