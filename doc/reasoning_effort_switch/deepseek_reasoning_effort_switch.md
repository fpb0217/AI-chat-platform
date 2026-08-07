---
title: DeepSeek 推理强度切换
feature: reasoning_effort_switch
status: accepted
implemented_at: 2026-08-07
accepted_at: 2026-08-07
source_plan: ../../plan/reasoning_effort_switch/deepseek_reasoning_effort_switch.md
---

# DeepSeek 推理强度切换

## 验收结论

本功能已完成实现、自动化验证、真实 DeepSeek API 冒烟和用户本地测试，并于 2026-08-07 验收。用户确认推理强度切换功能没有发现问题。

源计划：[DeepSeek 推理强度切换](../../plan/reasoning_effort_switch/deepseek_reasoning_effort_switch.md)

## 最终实现

- 当前模型 `deepseek-v4-flash` 支持关闭、低、高、最大四档推理强度。
- 推理档位按每次发送快照，由后端校验并映射为 DeepSeek Chat Completions 参数。
- 默认保持 `off`，旧请求省略档位时继续使用非思考模式。
- 后端识别 `reasoning_content` 和最终 `content` 的流式阶段，只向浏览器发送阶段状态和最终正文。
- 原始推理文本不发送到浏览器、不写入 SQLite，也不加入当前无工具调用的多轮历史。
- assistant 消息保存实际模型、推理档位和可用的 reasoning Token。
- 前端选择器支持桌面与移动布局、键盘操作、屏幕阅读器名称和生成期间锁定。
- 当前选择使用版本化 localStorage key `ai-chat.reasoning-level.v1` 保存，并在读取后经过共享 Schema 与服务端能力校验。

## 档位映射

| 产品档位 | 界面文案 | DeepSeek `thinking` | `reasoning_effort` |
| --- | --- | --- | --- |
| `off` | 关闭 | `{ "type": "disabled" }` | 不发送 |
| `low` | 低 | `{ "type": "enabled" }` | `low` |
| `high` | 高 | `{ "type": "enabled" }` | `high` |
| `max` | 最大 | `{ "type": "enabled" }` | `max` |

每次上游请求都会显式发送 `thinking`。关闭时省略 `reasoning_effort`；浏览器不能直接覆盖 `thinking`、模型、system prompt 或其他 DeepSeek 参数。

## 使用方式

1. 启动应用并打开聊天页面。
2. 点击顶部的模型与推理强度选择器。
3. 选择关闭、低、高或最大。
4. 发送消息；所选档位只对该次发送快照生效。
5. 思考模式收到推理流时顶部显示“正在深度思考”，进入最终回答后恢复“正在生成”。
6. assistant 消息标题旁显示本次实际档位；刷新页面后该标签从 SQLite 恢复。

最大档位通常可能产生更长等待和更多生成 Token。具体耗时与 Token 数取决于提示词和模型服务状态，单次结果不应视为性能基准。

## 公共接口

### `GET /api/health`

在原有健康信息之外返回当前模型能力：

```json
{
  "reasoningCapabilities": {
    "levels": ["off", "low", "high", "max"],
    "defaultLevel": "off"
  }
}
```

该接口不返回 API Key 或账户信息。

### `POST /api/chat/messages`

请求示例：

```json
{
  "content": "请分析这个问题",
  "reasoningLevel": "high"
}
```

- `reasoningLevel` 省略时默认成 `off`。
- 非法值返回 HTTP 400 和 `INVALID_REASONING_LEVEL`。
- 当前模型不支持的合法档位返回 HTTP 400 和 `UNSUPPORTED_REASONING_LEVEL`。
- 校验发生在创建 turn 前，无效请求不会留下用户消息或 assistant 占位行。

### SSE 事件

- `meta`：返回消息 ID、turn ID、模型和服务端确认的推理档位。
- `phase`：`reasoning` 表示正在推理，`answer` 表示开始输出最终回答。
- `delta`：只包含最终回答新增正文，不包含原始 reasoning content。
- `done`：包含结束原因及 usage；usage 的 `reasoningTokens` 可空。
- `error`：沿用稳定错误码、用户可读信息和 `retryable` 标记。

## 数据库迁移

Drizzle 迁移 `0001_hesitant_korath.sql` 为 `messages` 增加：

- `reasoning_level`：可空文本，新 assistant 消息保存 `off|low|high|max`。
- `reasoning_tokens`：可空整数，上游提供完整 usage 时保存。

旧消息迁移后两个字段保持 `null`，前端不会把旧数据伪装成 `off`。完成、停止和错误回答均保留创建 turn 时确认的推理档位。

## 代码结构

- `packages/shared/src/index.ts`：档位 Schema、默认值、能力响应、阶段事件、消息和 usage 类型。
- `apps/api/src/provider/types.ts`：Provider 能力及生成选项接口。
- `apps/api/src/provider/deepseek.ts`：模型能力、四档请求映射、阶段识别和 reasoning usage 解析。
- `apps/api/src/routes/chat.ts`：请求校验、能力检查、SSE 转换和持久化编排。
- `apps/api/src/db/schema.ts`、`repository.ts`：档位及 reasoning Token 持久化。
- `apps/web/src/components/ReasoningSelector.vue`：推理档位选择器和无障碍交互。
- `apps/web/src/composables/use_chat.ts`：能力加载、偏好、请求快照和流状态。
- `apps/web/src/components/ChatMessage.vue`：历史回答的档位标签。

## 验证结果

- ESLint：通过。
- TypeScript：shared、API、Web 和 E2E 全部通过。
- Vitest：shared 8 项、API 19 项、Web 13 项，共 40 项通过。
- Playwright：6 项通过，包含最大推理、思考阶段、刷新恢复和移动端选择器。
- Drizzle 迁移生成与内存数据库 Repository 测试：通过。
- shared、Vue 前端和 Fastify API 生产构建：通过。
- 真实 `deepseek-v4-flash` 四档冒烟：四次均以 `stop` 正常结束；关闭档只出现回答阶段且没有 reasoning Token，低、高、最大均依次出现推理与回答阶段并返回 reasoning Token。
- 用户在本地完成手动测试并确认没有发现问题。

## 安全与隐私

- `DEEPSEEK_API_KEY` 继续只由后端读取，未进入客户端代码、请求、本地偏好或文档。
- localStorage 只保存推理档位枚举，不保存提示词、回答或密钥。
- 原始 reasoning content 仅在后端流解析期间用于识别阶段，随后丢弃。
- 服务端日志不记录 API Key、上游请求体或原始推理文本。
- 默认本地数据目录 `data/` 已显式加入 `.gitignore`，避免聊天数据库及 sidecar 文件被提交。

## 已知限制

- 当前仍固定使用 `deepseek-v4-flash`，不支持模型切换。
- 不展示、复制或持久化原始思维链。
- 当前没有工具调用；后续加入工具调用时必须重新设计 reasoning content 的持久化和回传。
- 推理档位偏好只保存在当前浏览器，不支持跨设备或多用户同步。
- 不允许用户配置 `max_tokens`、temperature、请求超时或 reasoning Token 预算。
