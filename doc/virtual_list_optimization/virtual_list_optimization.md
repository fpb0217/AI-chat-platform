---
title: 长对话消息虚拟列表优化
feature: virtual_list_optimization
status: accepted
implemented_at: 2026-08-10
accepted_at: 2026-08-10
updated_at: 2026-08-10
source_plan: ../../plan/virtual_list_optimization/virtual_list_optimization.md
---

# 长对话消息虚拟列表优化

## 验收结论

本功能已完成动态高度消息虚拟化、稳定渲染身份、滚动跟随迁移、思考面板状态提升和长会话自动化回归，并于 2026-08-10 完成验证与用户验收归档。500 条混合消息的浏览器用例确认页面只挂载视口及 overscan 范围内的消息行，首屏定位、上下滚动、消息顺序和既有流式交互均通过回归。

源计划：[长对话消息虚拟列表优化](../../plan/virtual_list_optimization/virtual_list_optimization.md)

## 最终实现

- Web 端使用 `@tanstack/vue-virtual` 管理消息虚拟范围；消息总数不再直接决定已挂载的 Markdown、代码块和思考面板组件数量。
- 虚拟容器使用总高度占位，消息行按测量位置绝对定位；未知高度先根据角色、正文、思考内容和状态估算，挂载后再以实际 DOM 高度修正。
- `VirtualMessageList` 统一拥有主滚动容器、虚拟测量和自动跟随状态，`App.vue` 不再维护第二套内容级 `ResizeObserver` 或全历史内容拼接监听。
- 流式更新只观察消息数量、尾部消息身份、尾部正文与思考长度、消息状态及流式阶段，不再在每次增量时扫描和复制全部历史正文。
- 初次加载的历史消息不播放入场动画；只有当前页面中新加入的消息会播放一次动画，离屏行重新挂载时不会重复触发。
- 虚拟列表保留 `role="list"` / `role="listitem"`、`aria-posinset` 和 `aria-setsize`，流式阶段由独立 live region 播报，不把反复挂载的历史列表作为实时区域。

## 使用与滚动行为

用户无需开启额外配置。打开或切换到长会话后，界面会定位到最后一条消息，并遵守以下规则：

1. 位于底部时，流式正文、代码块和思考过程改变高度后继续跟随最新内容。
2. 用户主动向上滚动后立即暂停跟随，后续流式更新不抢回阅读位置。
3. 滚回底部 96px 范围或点击“回到底部”后恢复跟随。
4. 程序化跟随使用即时滚动；用户主动点击“回到底部”保留平滑滚动。
5. 切换会话会清理旧会话的测量与界面状态，并按现有产品行为定位到新会话底部。

虚拟列表使用 6 条 overscan 缓冲和 30px 行间距。动态测量通过虚拟器的元素测量能力完成，浏览器原生滚动锚定在主容器上关闭，避免与应用的滚动跟随逻辑竞争。

## 稳定渲染身份

`useChat` 在共享 `ChatMessage` 之外增加仅供当前页面渲染使用的 `renderKey`：

- 历史消息载入时为每条消息生成一次。
- 乐观 user/assistant 消息创建时立即生成。
- SSE `meta` 回填服务端消息 ID 与会话 ID 时保留原 `renderKey`。
- 发送失败移除乐观消息后，不会把被删除行的测量缓存复用给其他消息。

`renderKey` 不进入共享契约、API、SQLite 或模型上下文，只在当前页面生命周期内使用。

## 思考面板状态

`ReasoningPanel` 同时支持原有内部状态和虚拟列表使用的受控状态。虚拟列表以 `renderKey` 保存展开值，使消息离开并重新进入虚拟范围后仍保持当前页面内的手动展开或折叠选择。

- 活跃思考阶段默认展开，进入回答阶段后按既有规则自动折叠。
- 用户手动切换后，重新挂载同一消息时恢复该值。
- 切换会话会清理映射；刷新页面后历史思考过程仍按现有规则默认折叠。

## 数据、接口与测试夹具

生产数据边界保持不变：

- `GET /api/conversations/:conversationId` 仍返回会话的完整消息数组。
- SQLite Schema、Repository、共享 `ChatMessage`、SSE 事件和模型历史组装均未修改。
- 长会话只优化浏览器中的 DOM、布局和绘制范围，不减少响应载荷或前端消息对象本身的内存占用。

Playwright 测试服务在系统临时目录创建独立 SQLite 数据库，并通过 Repository 直接预置 250 轮、共 500 条混合状态消息；关闭服务时删除数据库及 WAL/SHM 文件。生产环境没有新增造数或调试接口。

## 代码结构

- `apps/web/src/components/VirtualMessageList.vue`：虚拟范围、动态测量、滚动跟随、会话状态、思考面板展开值和 live region。
- `apps/web/src/components/virtual_message_list.ts`：overscan、间距、底部阈值和未知高度估算。
- `apps/web/src/components/ChatMessage.vue`：虚拟列表语义、条件入场动画及受控思考面板接入。
- `apps/web/src/components/ReasoningPanel.vue`：兼容内部与受控两种展开状态。
- `apps/web/src/composables/use_chat.ts`：为历史与乐观消息提供稳定 `renderKey`。
- `apps/web/src/App.vue`：接入虚拟消息列表，并移除重复的主滚动与全历史监听逻辑。
- `apps/web/src/test/long_conversation.ts`：固定结构的 100/300/500 条消息测试数据。
- `e2e/fixture_server.ts`、`e2e/virtual_list.spec.ts`：临时数据库长会话夹具与浏览器回归。

## 验证结果

- ESLint：通过。
- TypeScript：shared、API、Web 和 E2E 全部通过。
- Vitest：shared 11 项、API 28 项、Web 35 项，共 74 项通过；Web 用例包含 100、300、500 条消息的挂载数量约束、空列表、稳定渲染键、历史动画和高度估算。
- Playwright：完整 14 项通过；500 条消息用例在 900×700 视口断言挂载行数不超过 30，并验证底部、顶部、中段滚动与消息顺序，同时保留流式回答、思考折叠、代码块增长、用户上滚、会话切换、移动端和主题回归。
- 生产构建：shared、Vue 前端和 Fastify API 全部通过；Vite 对当前约 501 kB 的单个压缩前 JavaScript chunk 给出体积提示，但不影响构建通过。
- `git diff --check`：通过。

本次归档没有保留可复核的优化前后 Performance Trace，因此不声明具体加载耗时、帧时间、长任务或内存降幅。当前性能结论限定为：挂载行数量受视口与 overscan 约束，不再随 100～500 条消息线性增长；精确的硬件性能对比仍需在固定环境另行采集。

## 安全与隐私

- 本功能不新增生产接口、数据库字段、远程请求、日志、分析事件或浏览器持久化项。
- `renderKey` 是随机页面内标识，不包含消息正文、会话内容或密钥，也不会传给服务端。
- 长会话测试数据为确定性虚构内容，只写入 E2E 临时数据库，不接触用户数据库。

## 已知限制

- 历史消息 API 仍无分页、懒加载或向上加载更多；500 条消息仍会完整传输并保存在前端状态中。
- 单条超长消息在进入视口后仍会完整渲染 Markdown、代码高亮和思考内容。
- 浏览器原生“在页面中查找”无法匹配当前未挂载的离屏消息；完整历史搜索需要单独实现。
- 暂不保存每个会话离开前的精确滚动位置，切换后仍定位到底部。
- 暂不处理模型上下文裁剪、摘要、归档、左侧会话列表虚拟化或服务端消息内存治理。
- 如需量化真实设备上的脚本、布局、帧时间和内存收益，仍需补充同一硬件与浏览器版本下的优化前后 Trace。
