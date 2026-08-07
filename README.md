# Local AI Chat Platform

一个本地运行的 Vue 3 + Fastify AI 对话 MVP，核心能力是通过 SSE 接收 DeepSeek 流式输出，并在浏览器中平滑呈现打字机效果。

## 本地启动

1. 安装 Node.js 24+ 与 pnpm 11+。
2. 复制 `.env.example` 为 `.env`，填写 `DEEPSEEK_API_KEY`。
3. 执行 `pnpm install`。
4. 执行 `pnpm db:migrate`。
5. 执行 `pnpm dev`，访问 `http://127.0.0.1:5173`。

生产模式可执行 `pnpm build` 后运行 `pnpm start`，访问 `http://127.0.0.1:3000`。

## 常用检查

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`

产品计划存放于 `plan/`；只有已经实现并经用户验收的功能文档才进入 `doc/`。

