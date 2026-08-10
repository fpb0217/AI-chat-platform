---
title: 浅色与深色主题切换
feature: theme_switch
status: accepted
implemented_at: 2026-08-10
accepted_at: 2026-08-10
updated_at: 2026-08-10
source_plan: ../../plan/theme_switch/theme_switch.md
---

# 浅色与深色主题切换

## 验收结论

本功能已完成浅色与深色双主题、刷新持久化、首屏无闪烁恢复、可访问顶栏入口和桌面/移动端适配，并于 2026-08-10 完成全部自动化验证与用户验收归档。

源计划：[浅色与深色主题切换](../../plan/theme_switch/theme_switch.md)

## 最终实现

- Web 端仅提供 `light` 与 `dark` 两种主题，不提供跟随系统模式；首次访问和无有效偏好时固定使用浅色。
- 顶栏使用单一原生按钮双向切换主题；浅色时显示月亮图标和“切换到深色模式”，深色时显示太阳图标和“切换到浅色模式”。
- 桌面端显示图标与文字，390px 移动视口压缩为图标按钮，保持可见且不造成横向溢出。
- 页面在 Vue 挂载前读取本地偏好并应用主题，深色刷新时不会先绘制浅色界面再切换。
- 切换同步更新 Vue 响应式状态、`<html data-theme>`、原生 `color-scheme`、浏览器 `theme-color` 和本地偏好。
- 全局样式使用浅色语义变量及 `:root[data-theme="dark"]` 覆盖值，统一驱动背景、表面、文本、边框、强调色、危险色、焦点环、阴影、遮罩和滚动条。
- 主题切换不修改后端、数据库或共享消息契约，也不重置会话、消息、草稿、推理强度、生成状态和滚动跟随状态。

## 后续修复

- 2026-08-10：修复从深色切回浅色后，会话操作菜单仍保留深色表面的样式。浅色主题下的 `--color-surface-menu` 和悬停色现分别使用白色与浅色表面色；深色主题继续保留独立的深色覆盖值。
- `e2e/chat.spec.ts` 新增回归用例：完成深色到浅色切换后，验证会话菜单和重命名模态框均使用浅色表面。
- 2026-08-10：将有填充的业务按钮收敛为 `button-primary`、`button-secondary` 和 `button-subtle` 三个语义角色。角色颜色只从主题基础变量派生，不再为发送、停止、保存或取消等组件维护独立的主题色，因此浅色与深色会随同一套基础调色板切换。
- `e2e/chat.spec.ts` 的浅色回归用例现会审计菜单和重命名模态框状态下的全部可见按钮；任何深色实体按钮背景或按钮背景图都会导致测试失败。

## 使用方式

1. 启动应用后，首次访问默认显示浅色主题。
2. 点击顶栏月亮按钮切换到深色；也可 Tab 聚焦后使用 Enter 或 Space。
3. 深色状态下点击太阳按钮切换回浅色。
4. 刷新或重新打开页面会恢复同一浏览器配置中最后保存的主题。

## 状态与持久化

主题产品类型为 `"light" | "dark"`，localStorage key 为 `ai-chat.theme.v1`。

- 只接受精确值 `light` 和 `dark`；缺失、空字符串或未知值均回退为 `light`。
- 操作系统深色偏好不影响默认值。
- `index.html` 中的最小启动脚本在首屏绘制前应用持久化主题。
- `useTheme` 使用相同的合法值、默认值和 DOM 同步规则初始化 Vue 状态。
- 用户切换时先更新内存和 DOM，再尝试写入 localStorage；写入抛错时当前页面仍完成切换。
- 读取 localStorage 抛错时应用仍以浅色启动。

浅色与深色分别使用 `#f7f7fb` 和 `#101016` 作为浏览器 `theme-color`，并把对应值同步到 `document.documentElement.style.colorScheme`。

## 界面与样式

主题变量覆盖以下区域：

- 应用背景、桌面侧栏、移动抽屉、顶栏与遮罩。
- 会话条目、操作菜单、新对话按钮和禁用状态。
- 用户与 assistant 消息、推理档位标签、思考过程面板和流式状态。
- Markdown 标题、链接、引用、行内代码、表格、代码块及复制控件。
- 空状态、加载状态、输入区、发送/停止按钮、错误提示和返回底部按钮。
- 重命名模态框、输入框、危险状态、焦点指示、阴影和滚动条。

主题相关过渡保持在 140～160ms，并继续由现有 `prefers-reduced-motion: reduce` 规则关闭动画。

## 代码结构

- `apps/web/index.html`：在 Vue 挂载前恢复主题，并同步首屏 `theme-color` 与 `color-scheme`。
- `apps/web/src/composables/use_theme.ts`：主题类型、合法值校验、读取、DOM 同步、切换和持久化。
- `apps/web/src/components/ThemeToggle.vue`：可访问的顶栏双向切换按钮。
- `apps/web/src/App.vue`：初始化主题状态并接入切换控件。
- `apps/web/src/style.css`：浅色语义变量、深色变量覆盖、按钮语义角色和响应式布局。
- `apps/web/src/composables/use_theme.test.ts`、`ThemeToggle.test.ts`：状态容错、DOM 同步和组件行为测试。
- `e2e/chat.spec.ts`：键盘切换、刷新恢复、非法值回退、深色切回浅色后的浮层及全部可见按钮配色和移动端布局回归。

## 验证结果

- ESLint：通过。
- TypeScript：shared、API、Web 和 E2E 全部通过。
- Vitest：shared 11 项、API 28 项、Web 27 项，共 66 项通过。
- Playwright：完整 13 项通过；主题用例覆盖默认浅色、Enter/Space 双向切换、localStorage 持久化、刷新恢复、`color-scheme` 同步和非法值回退，移动端用例验证切换按钮可见且无横向溢出。
- 生产构建：shared、Vue 前端和 Fastify API 全部通过。
- `git diff --check`：通过。
- 后续菜单配色修复：`pnpm lint`、`pnpm typecheck`、Web 生产构建及对应 Playwright 回归用例均通过。
- 后续按钮配色修复：`pnpm lint`、Web 类型检查、Web 生产构建和完整 16 项 Playwright 回归均通过。

## 安全与隐私

- localStorage 只保存 `light|dark` 枚举，不保存提示词、回答、会话内容、密钥或服务端配置。
- 主题值经过白名单校验，不能注入 CSS、HTML 或任意 DOM 属性。
- 本功能不新增网络请求、后端接口、数据库字段或分析事件。

## 已知限制

- 暂不支持跟随操作系统、按时间自动切换或自定义主题。
- 偏好只保存在当前浏览器，不跨浏览器、设备或账户同步。
- 多标签页之间不会通过 `storage` 事件实时同步；刷新后会读取最新保存值。
- 代码高亮沿用现有 `highlight.js` 深色方案，在浅色和深色主题中都使用深色代码块表面。
