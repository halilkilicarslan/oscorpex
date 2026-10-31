import { runMigrate } from "../migrate.js";

process.exitCode = await runMigrate();
