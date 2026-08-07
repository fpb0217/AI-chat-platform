import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const environment = loadEnv(mode, workspaceRoot, "");
  const defaultApiTarget =
    mode === "e2e" ? "http://127.0.0.1:3100" : "http://127.0.0.1:3000";

  return {
    envDir: workspaceRoot,
    plugins: [vue(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target:
            environment.VITE_API_PROXY_TARGET ?? defaultApiTarget,
          changeOrigin: false,
        },
      },
    },
  };
});
