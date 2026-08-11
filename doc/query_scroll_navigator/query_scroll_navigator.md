---
title: 正文区域用户 Query 定位滚动条
feature: query_scroll_navigator
status: accepted
implemented_at: 2026-08-11
accepted_at: 2026-08-11
updated_at: 2026-08-11
source_plan: ../../plan/query_scroll_navigator/query_scroll_navigator.md
---

# 正文区域用户 Query 定位滚动条

## 验收结论

聊天正文左侧现提供桌面端 Query 定位器。它以每条 user 消息为一个导航条目，能够在长会话中显示当前阅读轮次、预览关联回答，并跳转到指定问题。定位器使用固定中间高亮的五槽滑动窗口：上下滚动时，前后 Query 横杠会从相应边缘逐渐进入，避免仅显示五条横杠时无法判断前后是否仍有内容。

源计划：[正文区域用户 Query 定位滚动条](../../plan/query_scroll_navigator/query_scroll_navigator.md)

## 使用方式

- 当桌面端会话至少包含一条 user 消息时，正文左侧显示 Query 横杠；窄屏布局自动隐藏，不遮挡正文或输入区。
- 中间的白色长横杠表示正文当前阅读锚点所在的 Query。继续阅读该 Query 的 assistant 回答时，高亮保持不变。
- 鼠标悬停横杠或用 Tab 聚焦时，右侧卡片展示一行规范化后的 Query 与最多三行关联回答摘要。
- 点击横杠，或在聚焦后按 Enter / Space，会跳转至对应的 user 消息。跳转历史位置会暂停流式输出的底部自动跟随，避免阅读位置被拉回底部。
- 在 Query 超过五条时，将鼠标悬停在横杠或预览卡区域并使用鼠标滚轮、触控板上下滚动，可以浏览相邻 Query；滚动仅移动浏览游标和预览，不会直接跳转正文。
- Query 不超过五条时不存在额外条目可浏览，滚轮按原有行为继续作用于正文。

## 居中滑动窗口

定位器使用五个固定物理槽位和上下各一个缓冲项。当前 Query 始终位于第三槽位，白色高亮横杠作为独立覆盖层固定在这里，数据横杠在其下方移动。

例如会话有 9 条 Query，当前位于第 5 条时，完整可见槽位为第 3、4、5、6、7 条：

```text
3   4  [5]  6   7
```

- 向上滚动时，轨道向下移动：第 2 条从顶部逐渐出现，第 7 条从底部离开；完成一步后稳定为第 2、3、4、5、6 条，中央变为第 4 条。
- 向下滚动时，轨道向上移动：第 8 条从底部逐渐出现，第 3 条从顶部离开；完成一步后稳定为第 4、5、6、7、8 条，中央变为第 6 条。
- 触控板的小 `deltaY` 连续决定轨道位移比例；标准鼠标滚轮单格使用短动画完成同一移动。
- 到达首尾时，首条或末条仍位于中间槽位，缺失方向保留为空，不渲染虚假的横杠。静止状态最多显示五条完整横杠；第六条只在过渡中局部显现。

正文滚动也会同步更新中央 Query。相邻轮次切换使用同一轨道过渡；跨越多轮的程序化跳转会直接居中目标，避免连续播放冗长动画。`prefers-reduced-motion` 环境下保留正确的映射与跳转，省略非必要连续过渡。

## 最终实现

### 数据投影与预览

前端从已加载的 `RenderedChatMessage[]` 单次扫描构建 Query 导航元数据：每条 user 消息保留原数组索引、稳定 `renderKey` 与 `turnId`，同一 `turnId` 的 assistant 消息作为回答摘要来源。该结构只引用现有消息对象，不复制整段会话正文。

Query 与回答摘要会折叠 Markdown 标记、代码围栏、链接和连续空白，并使用普通文本渲染；`reasoningContent` 不进入预览。回答不存在时根据状态显示“正在生成回答…”、“回答已停止”、“回答生成失败”或“暂无回答”。

### 正文滚动与定位

`VirtualMessageList` 继续是正文滚动、虚拟行测量和自动跟随的唯一控制方。它根据实际阅读锚点的可见消息索引选出最近的 user Query，不依赖离屏 DOM，也不会被 virtualizer 的 overscan 行提前切换高亮。

跳转通过同一个 virtualizer 的 `scrollToIndex()` 实现，并在下一帧重新测量和有限校正。跳转前关闭 `followOutput`，同时更新滚动基线，确保动态行高修正不会被误判为用户主动上滚。

### 可访问性与布局

- 每个可见条目均为原生 `button`，提供包含序号和问题文本的 `aria-label`；当前条目使用 `aria-current="location"`。
- 上下缓冲项在视窗外裁切，不能取得键盘焦点或被辅助技术当作可见导航项。
- 预览使用 `role="tooltip"` 并经 `aria-describedby` 关联至当前悬停或聚焦的条目；Escape 关闭预览。
- 定位器由相对定位的正文区域承载，不参与正文滚动；深浅主题复用现有 CSS 变量，860px 以下隐藏。

## 代码结构

- `apps/web/src/components/QueryScrollNavigator.vue`：居中滑动轨道、缓冲项、滚轮输入、预览、键盘和无障碍交互。
- `apps/web/src/components/query_scroll_navigator.ts`：Query/assistant 投影、摘要规范化、居中窗口和当前 Query 纯逻辑。
- `apps/web/src/components/VirtualMessageList.vue`：正文阅读锚点同步、按消息索引跳转、虚拟列表与自动跟随集成。
- `apps/web/src/style.css`：五槽裁切视窗、固定中心标记、主题、预览和响应式样式。
- `apps/web/src/components/query_scroll_navigator.test.ts`、`apps/web/src/components/VirtualMessageList.test.ts`：纯逻辑、组件、跳转与跟随回归。
- `e2e/virtual_list.spec.ts`：长会话导航、真实鼠标滚轮、居中槽位、渐显轨道和跳转回归。

## 数据、接口与隐私边界

- 不修改 `ChatMessage`、SSE、Zod Schema、SQLite Schema、Repository、会话 API、模型上下文或推理内容持久化。
- 不新增网络请求、浏览器持久化、分析事件或日志；导航数据完全从当前浏览器内已加载的会话消息派生。
- 定位器不为所有 Query 创建隐藏消息锚点，长会话的消息 DOM 挂载数量仍由虚拟范围决定。

## 验证结果

- ESLint：`pnpm lint` 通过。
- TypeScript：`pnpm typecheck` 通过，覆盖 shared、API、Web 与 E2E 类型检查。
- Vitest：`pnpm test` 共 89 项通过；覆盖 turn 配对、预览规范化、9 条 Query 的 3–7 居中映射、上下缓冲渐显、首尾留空、点击跳转与虚拟滚动状态。
- Playwright：`pnpm test:e2e` 共 17 项通过；定位器用例以真实 `page.mouse.wheel()` 验证原生滚轮可以浏览 Query 并保持点击跳转行为。
- 生产构建：`pnpm build` 通过。Vite 对当前约 509 kB 的单个压缩前 JavaScript chunk 给出体积提示，但不影响构建结果。
- `git diff --check`：通过。

## 已知限制

- 移动端与窄屏没有替代 Query 导航入口，当前直接隐藏定位器。
- 不支持在定位器中搜索、筛选、编辑、复制或展开完整 Query / 回答。
- 手动浏览游标不跨刷新或会话切换持久化；切换会话后按当前正文阅读位置重新计算。
- 仅为已加载到浏览器的消息提供导航；未来若引入历史分页，需要另行设计跨页索引与加载后定位。
