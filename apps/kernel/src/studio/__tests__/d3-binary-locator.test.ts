// ---------------------------------------------------------------------------
// D3 — binary-locator in the production image: CLAUDE_CLI_PATH wins when set, and in production the locator never
// starts a login shell (`-l`/`-lc`, which sources tenant-writable profile files) nor probes HOME-based candidates.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnCalls: { bin: string; args: string[] }[] = [];

vi.mock("node:child_process", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		spawn: (bin: string, args: string[]) => {
			spawnCalls.push({ bin, args: [...args] });
			const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
			proc.stdout = new EventEmitter();
			proc.kill = vi.fn();
			setTimeout(() => proc.emit("close", 1), 5);
			return proc;
		},
	};
});
vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const KEYS = ["CLAUDE_CLI_PATH", "HOME", "NODE_ENV", "SHELL"];
const saved: Record<string, string | undefined> = {};
let home: string;
let homeClaude: string;
let configured: string;

function setEnv(k: string, v: string | undefined) {
	if (v === undefined) Reflect.deleteProperty(process.env, k);
	else process.env[k] = v;
}

beforeEach(() => {
	for (const k of KEYS) saved[k] = process.env[k];
	spawnCalls.length = 0;
	home = mkdtempSync(join(tmpdir(), "oscx-d3-home-"));
	mkdirSync(join(home, ".local", "bin"), { recursive: true });
	homeClaude = join(home, ".local", "bin", "claude");
	writeFileSync(homeClaude, "#!/bin/sh\nexit 0\n");
	chmodSync(homeClaude, 0o755);
	configured = join(home, "configured-claude");
	writeFileSync(configured, "#!/bin/sh\nexit 0\n");
	chmodSync(configured, 0o755);
	setEnv("HOME", home);
	setEnv("SHELL", "/bin/sh");
});
afterEach(() => {
	for (const k of KEYS) setEnv(k, saved[k]);
	rmSync(home, { recursive: true, force: true });
});

describe("D3: binary-locator", () => {
	it("control: in development the HOME-based candidate is found (the probe is valid)", async () => {
		setEnv("NODE_ENV", "development");
		Reflect.deleteProperty(process.env, "CLAUDE_CLI_PATH");
		const { locateBinary } = await import("../cli-usage/binary-locator.js");
		expect(await locateBinary("claude")).toBe(homeClaude);
	});

	it("CLAUDE_CLI_PATH wins when set (even when a HOME candidate exists), without spawning a shell", async () => {
		setEnv("NODE_ENV", "production");
		setEnv("CLAUDE_CLI_PATH", configured);
		const { locateBinary } = await import("../cli-usage/binary-locator.js");
		expect(await locateBinary("claude")).toBe(configured);
		expect(spawnCalls).toEqual([]);
	});

	it("production: never uses a login shell and never returns a HOME-based candidate", async () => {
		setEnv("NODE_ENV", "production");
		Reflect.deleteProperty(process.env, "CLAUDE_CLI_PATH");
		const { locateBinary } = await import("../cli-usage/binary-locator.js");
		const found = await locateBinary("claude");
		for (const c of spawnCalls) {
			expect(
				c.args.some((a) => /^-[a-z]*l[a-z]*$/.test(a)),
				`login shell used: ${c.bin} ${c.args.join(" ")}`,
			).toBe(false);
		}
		expect(found).not.toBe(homeClaude);
		expect(found === undefined || !found.startsWith(home)).toBe(true);
	});
});
