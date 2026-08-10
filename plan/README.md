# Plan Index

`plan/` 保存所有已形成明确范围的功能计划。每个功能使用一份持续更新的主文件，关键修订记录写在文件末尾，完整差异由 Git 保存。

## 状态

- `draft`：讨论中，尚未确认。
- `approved`：范围与方案已确认，等待实现。
- `implementing`：正在实现。
- `implemented_pending_acceptance`：实现与内部验证完成，等待用户验收。
- `accepted`：用户已验收；对应最终文档应存在于 `doc/`。
- `superseded`：已被另一份计划替代，并注明替代文件。

## 命名与生命周期

- 功能目录及 Markdown 文件统一使用英文 `snake_case`。
- 新功能首次形成计划时才创建对应目录，不预建空目录。
- 验收后保留原计划，并在 `doc/<feature>/` 新增独立的最终实现文档。
- 最终文档应包含源计划链接、接口、配置、验证结果、使用方式与已知限制。
- 已验收的重要 Bug 修复统一归档到 `doc/fixes/`，记录现象、根因、修复方案、回归测试与最终效果；简单且低风险的局部错误无需单独建档。

## 当前计划

| 功能 | 计划 | 状态 | 最近更新 |
| --- | --- | --- | --- |
| 流式输出 | [本地 SSE 流式 AI 对话 MVP](streaming_output/local_sse_chat_mvp.md) | `accepted` | 2026-08-08 |
| 推理强度切换 | [DeepSeek 推理强度切换](reasoning_effort_switch/deepseek_reasoning_effort_switch.md) | `accepted` | 2026-08-07 |
| 思考过程折叠区 | [DeepSeek 思考过程流式展示与折叠](reasoning_chain_panel/deepseek_reasoning_chain_panel.md) | `accepted` | 2026-08-08 |
| 会话列表管理 | [会话列表管理](session_list_management/session_list_management.md) | `accepted` | 2026-08-10 |
| 主题切换 | [浅色与深色主题切换](theme_switch/theme_switch.md) | `accepted` | 2026-08-10 |
| 长对话虚拟列表优化 | [长对话消息虚拟列表优化](virtual_list_optimization/virtual_list_optimization.md) | `accepted` | 2026-08-10 |
