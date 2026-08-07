import { loadConfig } from "../config.js";
import { createDatabase } from "./client.js";

const config = loadConfig();
const database = createDatabase(config.databasePath, config.migrationsFolder);
database.close();

process.stdout.write(`SQLite migrations are up to date: ${config.databasePath}\n`);

