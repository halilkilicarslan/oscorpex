import { describe, expect, it } from "vitest";
import { buildSafeChildEnv } from "../security/env-sanitizer.js";

// D3: the kernel image runs the Claude CLI with CLAUDE_CONFIG_DIR pointing into the persisted volume, so the
// provider profile must hand it (and DISABLE_AUTOUPDATER) over while still stripping platform secrets.
const BASE: NodeJS.ProcessEnv = {
	PATH: "/usr/bin:/opt/claude-cli/node_modules/.bin",
	HOME: "/home/oscorpex",
	NODE_ENV: "production",
	CLAUDE_CONFIG_DIR: "/home/oscorpex/.claude",
	DISABLE_AUTOUPDATER: "1",
	DATABASE_URL: "postgres://u:p@db/oscorpex",
	OSCORPEX_JWT_SECRET: "jwt-secret",
	AWS_SECRET_ACCESS_KEY: "aws-secret",
};

describe("D3: provider child env for the containerised Claude CLI", () => {
	it("provider profile keeps CLAUDE_CONFIG_DIR and DISABLE_AUTOUPDATER", () => {
		const env = buildSafeChildEnv({ profile: "provider", base: BASE });
		expect(env.CLAUDE_CONFIG_DIR).toBe("/home/oscorpex/.claude");
		expect(env.DISABLE_AUTOUPDATER).toBe("1");
		expect(env.HOME).toBe("/home/oscorpex");
		expect(env.PATH).toBe(BASE.PATH);
	});

	it("provider profile still strips platform secrets", () => {
		const env = buildSafeChildEnv({ profile: "provider", base: BASE });
		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.OSCORPEX_JWT_SECRET).toBeUndefined();
		expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
	});

	it("provider profile does not invent the vars when the base lacks them", () => {
		const env = buildSafeChildEnv({ profile: "provider", base: { PATH: "/usr/bin" } });
		expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
		expect(env.DISABLE_AUTOUPDATER).toBeUndefined();
	});

	for (const profile of ["app_runner", "build_tool", "test"] as const) {
		it(`${profile} (strict allowlist) does NOT gain CLAUDE_CONFIG_DIR or DISABLE_AUTOUPDATER`, () => {
			const env = buildSafeChildEnv({ profile, base: BASE });
			expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
			expect(env.DISABLE_AUTOUPDATER).toBeUndefined();
			expect(env.DATABASE_URL).toBeUndefined();
			expect(env.OSCORPEX_JWT_SECRET).toBeUndefined();
		});
	}
});

const BROADENED_SECRET_KEYS = [
	"ANTHROPIC_ADMIN_API_KEY",
	"ANTHROPIC_ADMIN_KEY",
	"CLAUDE_ADMIN_API_KEY",
	"FOO_PASSWORD",
	"DB_PASSWORD",
	"MY_CREDENTIALS",
	"SOME_API_KEY",
	"X_PRIVATE_KEY",
];

describe("D3: broadened secret deny patterns (provider profile)", () => {
	for (const key of BROADENED_SECRET_KEYS) {
		it(`strips ${key} from the base env`, () => {
			const env = buildSafeChildEnv({ profile: "provider", base: { ...BASE, [key]: "s3cret" } });
			expect(env[key]).toBeUndefined();
			// the passthrough vars survive
			expect(env.CLAUDE_CONFIG_DIR).toBe("/home/oscorpex/.claude");
			expect(env.DISABLE_AUTOUPDATER).toBe("1");
			expect(env.HOME).toBe("/home/oscorpex");
			expect(env.PATH).toBe(BASE.PATH);
		});
	}

	it("blocks the broadened keys in `extra` unless explicitly allowed", () => {
		const extra = Object.fromEntries(BROADENED_SECRET_KEYS.map((k) => [k, "v"]));
		const blocked = buildSafeChildEnv({ profile: "provider", base: { PATH: "/usr/bin" }, extra });
		for (const key of BROADENED_SECRET_KEYS) expect(blocked[key]).toBeUndefined();

		const allowed = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin" },
			extra: { SOME_API_KEY: "v" },
			allow: ["SOME_API_KEY"],
		});
		expect(allowed.SOME_API_KEY).toBe("v");
	});

	it("explicitly passed provider keys (extra) still pass; base-inherited ones do not", () => {
		const passed = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-inherited", OPENAI_API_KEY: "sk-inherited" },
			extra: { ANTHROPIC_API_KEY: "sk-ant-explicit", OPENAI_API_KEY: "sk-explicit" },
		});
		expect(passed.ANTHROPIC_API_KEY).toBe("sk-ant-explicit");
		expect(passed.OPENAI_API_KEY).toBe("sk-explicit");

		const inherited = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-inherited", OPENAI_API_KEY: "sk-inherited" },
		});
		expect(inherited.ANTHROPIC_API_KEY).toBeUndefined();
		expect(inherited.OPENAI_API_KEY).toBeUndefined();
	});

	it("does not over-block ordinary variables", () => {
		const env = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin", LANG: "C.UTF-8", NODE_ENV: "production", OSCORPEX_CLAUDE_MAX_TURNS: "80" },
		});
		expect(env.LANG).toBe("C.UTF-8");
		expect(env.NODE_ENV).toBe("production");
		expect(env.OSCORPEX_CLAUDE_MAX_TURNS).toBe("80");
	});
});

// ---------------------------------------------------------------------------
// Per-provider API key scoping. Contract: env-sanitizer.ts exports `providerEnvKeys(provider)` returning the API
// key variables a provider CLI may receive; gemini/cursor spawn paths pass exactly those via extra + allow.
// claude and codex get none from this helper (agent-runtime keeps passing ANTHROPIC/OPENAI keys explicitly, as
// today; adding ANTHROPIC_API_KEY anywhere else would override OAuth billing).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sanitizer from "../security/env-sanitizer.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALL_PROVIDER_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CURSOR_API_KEY"];

function providerEnvKeys(provider: string): string[] {
	const fn = (sanitizer as Record<string, unknown>).providerEnvKeys;
	expect(typeof fn, "env-sanitizer.ts must export providerEnvKeys(provider: string): string[]").toBe("function");
	return (fn as (p: string) => string[])(provider);
}

/** Mirrors how a spawn path hands its provider's keys to the child env. */
function spawnEnv(provider: string, from: Record<string, string>) {
	const keys = providerEnvKeys(provider);
	const extra = Object.fromEntries(keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]]));
	return buildSafeChildEnv({ profile: "provider", base: { PATH: "/usr/bin" }, extra, allow: keys });
}

describe("D3: providerEnvKeys scopes API keys per provider", () => {
	const ALL = Object.fromEntries(ALL_PROVIDER_KEYS.map((k) => [k, `v-${k}`]));

	it("gemini -> GEMINI_API_KEY and GOOGLE_API_KEY only", () => {
		expect([...providerEnvKeys("gemini")].sort()).toEqual(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
		const env = spawnEnv("gemini", ALL);
		expect(env.GEMINI_API_KEY).toBe("v-GEMINI_API_KEY");
		expect(env.GOOGLE_API_KEY).toBe("v-GOOGLE_API_KEY");
		for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CURSOR_API_KEY"]) expect(env[k]).toBeUndefined();
	});

	it("cursor -> CURSOR_API_KEY only", () => {
		expect(providerEnvKeys("cursor")).toEqual(["CURSOR_API_KEY"]);
		const env = spawnEnv("cursor", ALL);
		expect(env.CURSOR_API_KEY).toBe("v-CURSOR_API_KEY");
		for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
			expect(env[k]).toBeUndefined();
		}
	});

	for (const provider of ["claude", "claude-code", "codex"]) {
		it(`${provider} -> no key is added by the helper`, () => {
			expect(providerEnvKeys(provider)).toEqual([]);
			const env = spawnEnv(provider, ALL);
			for (const k of ALL_PROVIDER_KEYS) expect(env[k]).toBeUndefined();
		});
	}

	it("unknown providers get no keys", () => {
		expect(providerEnvKeys("nope")).toEqual([]);
	});

	it("explicit ANTHROPIC/OPENAI extra keys on the provider profile still pass (agent-runtime behaviour)", () => {
		const env = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin" },
			extra: { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" },
		});
		expect(env.ANTHROPIC_API_KEY).toBe("a");
		expect(env.OPENAI_API_KEY).toBe("o");
	});

	// Spawn sites for gemini/cursor must route their keys through the helper.
	for (const file of ["planner-cli.ts", "cli-language-model.ts", "legacy/cli-adapter.ts"]) {
		it(`${file} passes gemini/cursor keys through providerEnvKeys`, () => {
			const text = readFileSync(join(SRC, file), "utf8");
			expect(text).toMatch(/providerEnvKeys\(/);
		});
	}
});

describe("D3: corepack variables reach child processes (pre-seeded pnpm)", () => {
	const withCorepack = {
		...BASE,
		COREPACK_HOME: "/opt/corepack",
		COREPACK_DEFAULT_TO_LATEST: "0",
	};
	for (const profile of ["app_runner", "build_tool", "test", "provider"] as const) {
		it(`${profile} passes COREPACK_HOME and COREPACK_DEFAULT_TO_LATEST and still strips secrets`, () => {
			const env = buildSafeChildEnv({ profile, base: withCorepack });
			expect(env.COREPACK_HOME).toBe("/opt/corepack");
			expect(env.COREPACK_DEFAULT_TO_LATEST).toBe("0");
			expect(env.DATABASE_URL).toBeUndefined();
			expect(env.OSCORPEX_JWT_SECRET).toBeUndefined();
			expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
		});
	}
});

describe("D3: secret deny patterns, round 3", () => {
	const REMOVED = ["MY_SECRET_THING", "SECRETS_FILE", "FOO_SECRET_BAR", "DB_PASSWD", "PASSWD", "ROOT_PASSWD_HASH"];
	for (const key of REMOVED) {
		it(`provider profile strips ${key}`, () => {
			const env = buildSafeChildEnv({ profile: "provider", base: { ...BASE, [key]: "x" } });
			expect(env[key]).toBeUndefined();
		});
	}

	// Credential file *paths* are needed for Vertex AI / Bedrock; the provider profile must keep them.
	for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "AWS_SHARED_CREDENTIALS_FILE"]) {
		it(`provider profile keeps ${key} (a path, not a secret)`, () => {
			const env = buildSafeChildEnv({ profile: "provider", base: { ...BASE, [key]: "/home/oscorpex/.cred.json" } });
			expect(env[key]).toBe("/home/oscorpex/.cred.json");
			expect(env.DATABASE_URL).toBeUndefined();
		});
	}

	it("other credential-looking names are still stripped", () => {
		const env = buildSafeChildEnv({
			profile: "provider",
			base: { ...BASE, MY_CREDENTIALS: "x", STRIPE_CREDENTIAL: "y" },
		});
		expect(env.MY_CREDENTIALS).toBeUndefined();
		expect(env.STRIPE_CREDENTIAL).toBeUndefined();
	});

	it("agent-runtime passes the cursor key through pickEnv(providerEnvKeys(...))", () => {
		const text = readFileSync(join(SRC, "agent-runtime.ts"), "utf8");
		expect(text).toMatch(/pickEnv\(\s*providerEnvKeys\(/);
	});
});
