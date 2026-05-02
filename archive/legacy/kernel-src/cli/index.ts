#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Oscorpex CLI — main entry point
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerDeploy } from "./commands/deploy.js";
import { registerInit } from "./commands/init.js";
import { registerProjects } from "./commands/projects.js";
import { registerStart } from "./commands/start.js";
import { registerStatus } from "./commands/status.js";

// ---------------------------------------------------------------------------
// Resolve package.json version
// ---------------------------------------------------------------------------
function getVersion(): string {
	try {
		const __dirname = fileURLToPath(new URL(".", import.meta.url));
		const pkgPath = join(__dirname, "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
		return pkg.version;
	} catch {
		return "0.0.0";
	}
}

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------
const program = new Command();

program
	.name("oscorpex")
	.description("CLI for the Oscorpex AI-powered development platform")
	.version(getVersion(), "-v, --version", "Show CLI version")
	.option("--api-url <url>", "Oscorpex API base URL", process.env.OSCORPEX_API_URL ?? "http://localhost:3141")
	.option(
		"--api-key <key>",
		"API key for authentication (or set OSCORPEX_API_KEY env var)",
		process.env.OSCORPEX_API_KEY,
	);

// ---------------------------------------------------------------------------
// Register sub-commands
// ---------------------------------------------------------------------------
registerInit(program);
registerStart(program);
registerStatus(program);
registerDeploy(program);
registerProjects(program);

// ---------------------------------------------------------------------------
// Parse and run
// ---------------------------------------------------------------------------
program.parseAsync(process.argv).catch((err: unknown) => {
	const msg = err instanceof Error ? err.message : String(err);
	process.stderr.write(`\nFatal error: ${msg}\n`);
	process.exit(1);
});
