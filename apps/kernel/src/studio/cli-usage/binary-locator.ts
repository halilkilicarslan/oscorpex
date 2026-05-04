// ---------------------------------------------------------------------------
// Oscorpex — CLI Usage Observatory — Binary Locator
// Handles binary discovery, command execution, and security utilities.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger.js";
import type { CLIProviderDef } from "./types.js";

const log = createLogger("cli-usage:binary-locator");

const TOKENISH_KEYS = /token|secret|credential|cookie|authorization|access|refresh|api[_-]?key/i;

export function sanitizeError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
		.replace(/(?:sk-|AIza)[A-Za-z0-9_-]{10,}/g, "[redacted-key]")
		.replace(/[?&](key|token|api_key|access_token)=[^&\s]+/gi, "?$1=[redacted]")
		.slice(0, 400);
}

export function assertNoTokenishValues(value: unknown, seen = new Set<unknown>()): void {
	if (!value || typeof value !== "object") return;
	if (seen.has(value)) return;
	seen.add(value);
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (TOKENISH_KEYS.test(key)) {
			throw new Error(`Refusing to persist token-like snapshot key: ${key}`);
		}
		if (typeof nested === "object") assertNoTokenishValues(nested, seen);
	}
}

function commonPaths(): string[] {
	const home = homedir();
	return [
		`${home}/.local/bin`,
		`${home}/.cargo/bin`,
		`${home}/bin`,
		"/opt/homebrew/bin",
		"/usr/local/bin",
		`${home}/.npm-global/bin`,
		`${home}/Library/pnpm`,
		`${home}/.nvm/versions`,
	];
}

function findInCommonPaths(binary: string): string | undefined {
	for (const base of commonPaths()) {
		const direct = join(base, binary);
		if (existsSync(direct)) return direct;

		if (base.includes(".nvm/versions")) {
			const nodeRoot = join(base, "node");
			if (!existsSync(nodeRoot)) continue;
			try {
				const versions = readdirSync(nodeRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
				for (const version of versions) {
					const candidate = join(nodeRoot, version, "bin", binary);
					if (existsSync(candidate)) return candidate;
				}
			} catch {
				// ignore
			}
		}
	}
	return undefined;
}

export function locateBinary(binary: string): Promise<string | undefined> {
	if (!/^[a-zA-Z0-9_-]+$/.test(binary)) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const shell = process.env.SHELL || "/bin/zsh";
		const proc = spawn(shell, ["-lc", `command -v ${binary}`], {
			stdio: ["ignore", "pipe", "ignore"],
			env: { ...process.env, PATH: process.env.PATH },
		});
		let output = "";
		proc.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf-8");
		});
		proc.on("close", (code) => {
			const resolved = code === 0 ? output.trim().split("\n")[0] : undefined;
			resolve(resolved || findInCommonPaths(binary));
		});
		proc.on("error", () => resolve(findInCommonPaths(binary)));
		setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			resolve(findInCommonPaths(binary));
		}, 3_000);
	});
}

export function runCommand(
	binary: string,
	args: string[],
	options?: { input?: string; timeoutMs?: number; envExclusions?: string[] },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const env = { ...process.env };
		for (const key of options?.envExclusions ?? []) {
			delete env[key];
		}

		const proc = spawn(binary, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
			shell: false,
		});
		let stdout = "";
		let stderr = "";
		const maxOutput = 80_000;
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {
				// ignore
			}
			reject(new Error(`Command timed out: ${binary} ${args.join(" ")}`));
		}, options?.timeoutMs ?? 15_000);

		proc.stdout?.on("data", (chunk: Buffer) => {
			stdout = (stdout + chunk.toString("utf-8")).slice(-maxOutput);
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString("utf-8")).slice(-maxOutput);
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		if (options?.input) {
			proc.stdin?.write(options.input);
		}
		proc.stdin?.end();
	});
}

export async function probeBinary(
	def: CLIProviderDef,
): Promise<{ installed: boolean; binaryPath?: string; version?: string; errors: string[] }> {
	const binaryPath = await locateBinary(def.binary);
	if (!binaryPath) return { installed: false, errors: [] };

	try {
		const result = await runCommand(binaryPath, def.versionArgs, { timeoutMs: 5_000 });
		const version = (result.stdout.trim() || result.stderr.trim()).split("\n")[0];
		return {
			installed: true,
			binaryPath,
			version,
			errors: result.code === 0 ? [] : [`version exited with code ${result.code}`],
		};
	} catch (err) {
		return { installed: true, binaryPath, errors: [sanitizeError(err)] };
	}
}
