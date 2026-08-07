import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

export const DEEPSEEK_MODEL = "deepseek-v4-flash";

const environmentSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_PATH: z.string().default("data/chat.db"),
  WEB_DIST_PATH: z.string().default("apps/web/dist"),
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.url().default("https://api.deepseek.com"),
  DEEPSEEK_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(600_000),
});

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  migrationsFolder: string;
  webDistPath: string;
  deepSeekApiKey: string;
  deepSeekBaseUrl: string;
  requestTimeoutMs: number;
  workspaceRoot: string;
}

export function findWorkspaceRoot(startDirectory = process.cwd()): string {
  let current = resolve(startDirectory);

  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
}

function resolveFromRoot(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

export function loadConfig(): AppConfig {
  const workspaceRoot = findWorkspaceRoot();
  const envFile = join(workspaceRoot, ".env");

  if (existsSync(envFile)) {
    loadDotEnv({ path: envFile, quiet: true });
  }

  const environment = environmentSchema.parse(process.env);

  return {
    host: environment.HOST,
    port: environment.PORT,
    databasePath: resolveFromRoot(workspaceRoot, environment.DATABASE_PATH),
    migrationsFolder: resolve(workspaceRoot, "apps/api/drizzle"),
    webDistPath: resolveFromRoot(workspaceRoot, environment.WEB_DIST_PATH),
    deepSeekApiKey: environment.DEEPSEEK_API_KEY,
    deepSeekBaseUrl: environment.DEEPSEEK_BASE_URL.replace(/\/$/, ""),
    requestTimeoutMs: environment.DEEPSEEK_REQUEST_TIMEOUT_MS,
    workspaceRoot,
  };
}

