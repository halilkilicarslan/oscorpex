// ---------------------------------------------------------------------------
// F3-a — append the implicit-scope inventory of one test file to a JSONL report.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getImplicitScopeCallers } from "../../pg.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../../..");

export function flushImplicitScopeReport(path: string, testFile: string): void {
	const records = getImplicitScopeCallers();
	if (records.length === 0) return;
	const rel = relative(REPO_ROOT, testFile).split(sep).join("/");
	appendFileSync(path, records.map((r) => `${JSON.stringify({ testFile: rel, ...r })}\n`).join(""));
}
