import { describe, expect, it } from "vitest";
import { assertNoSensitiveEnv, buildSafeChildEnv } from "../security/env-sanitizer.js";

describe("P1-2: Environment sanitization", () => {
	it("app_runner strips DATABASE_URL, JWT_SECRET, API_KEY, GITHUB_TOKEN", () => {
		const base: NodeJS.ProcessEnv = {
			PATH: "/usr/bin",
			HOME: "/home/test",
			NODE_ENV: "development",
			DATABASE_URL: "postgres://secret@localhost/db",
			OSCORPEX_JWT_SECRET: "jwt-secret",
			OSCORPEX_API_KEY: "api-key",
			GITHUB_TOKEN: "ghp_abc",
			SAFE_VAR: "safe",
		};
		const result = buildSafeChildEnv({ profile: "app_runner", base });
		expect(result.PATH).toBe("/usr/bin");
		expect(result.SAFE_VAR).toBe("safe");
		expect(result.DATABASE_URL).toBeUndefined();
		expect(result.OSCORPEX_JWT_SECRET).toBeUndefined();
		expect(result.OSCORPEX_API_KEY).toBeUndefined();
		expect(result.GITHUB_TOKEN).toBeUndefined();
	});

	it("provider profile includes explicitly passed ANTHROPIC_API_KEY", () => {
		const result = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin" },
			extra: { ANTHROPIC_API_KEY: "sk-ant-explicit" },
		});
		expect(result.ANTHROPIC_API_KEY).toBe("sk-ant-explicit");
	});

	it("provider profile does NOT inherit API keys from base env", () => {
		const result = buildSafeChildEnv({
			profile: "provider",
			base: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-ant-leaked" },
			extra: {},
		});
		expect(result.ANTHROPIC_API_KEY).toBeUndefined();
	});

	it("PATH, HOME, NODE_ENV always pass through", () => {
		const result = buildSafeChildEnv({
			profile: "build_tool",
			base: { PATH: "/usr/bin", HOME: "/home/u", NODE_ENV: "test" },
		});
		expect(result.PATH).toBe("/usr/bin");
		expect(result.HOME).toBe("/home/u");
		expect(result.NODE_ENV).toBe("test");
	});

	it("assertNoSensitiveEnv throws for leaked DATABASE_URL", () => {
		expect(() => assertNoSensitiveEnv({ DATABASE_URL: "leaked" } as NodeJS.ProcessEnv)).toThrow("Sensitive env var leaked");
	});

	it("extra sensitive vars blocked unless explicitly allowed", () => {
		const result = buildSafeChildEnv({
			profile: "db_provisioner",
			base: { PATH: "/usr/bin" },
			extra: { DATABASE_URL: "needed" },
			allow: ["DATABASE_URL"],
		});
		expect(result.DATABASE_URL).toBe("needed");
	});
});
