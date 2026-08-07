import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ errorName: (error as Error).name }, "Server failed to start");
  process.exitCode = 1;
}

