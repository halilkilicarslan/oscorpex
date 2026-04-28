// ---------------------------------------------------------------------------
// Auth Config Boot Phase — Fail-Closed Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("../logger.js", () => ({
	createLogger: () => mockLogger,
}));

describe("authConfigPhase — fail-closed", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
		mockLogger.error.mockClear();
		mockLogger.info.mockClear();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("allows development boot with auth disabled", async () => {
		process.env.NODE_ENV = "development";
		delete process.env.OSCORPEX_AUTH_ENABLED;
		const { authConfigPhase } = await import("../../boot-phases/auth-config-phase.js");
		expect(() => authConfigPhase()).not.toThrow();
	});

	it("throws when NODE_ENV=production and OSCORPEX_AUTH_ENABLED=false", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "false";
		const { authConfigPhase } = await import("../../boot-phases/auth-config-phase.js");
		expect(() => authConfigPhase()).toThrow("Production boot failed: auth must be enabled");
	});

	it("throws when NODE_ENV=production and OSCORPEX_AUTH_ENABLED is missing", async () => {
		process.env.NODE_ENV = "production";
		delete process.env.OSCORPEX_AUTH_ENABLED;
		const { authConfigPhase } = await import("../../boot-phases/auth-config-phase.js");
		expect(() => authConfigPhase()).toThrow("Production boot failed: auth must be enabled");
	});

	it("throws when production auth enabled but no secret configured", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		delete process.env.OSCORPEX_JWT_SECRET;
		delete process.env.OSCORPEX_API_KEY;
		const { authConfigPhase } = await import("../../boot-phases/auth-config-phase.js");
		expect(() => authConfigPhase()).toThrow(
			"Production boot failed: auth enabled but no mechanism configured",
		);
	});

	it("passes when production auth enabled with JWT secret", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		process.env.OSCORPEX_JWT_SECRET = "super-secret";
		delete process.env.OSCORPEX_API_KEY;
		const { authConfigPhase } = await import("../../boot-phases/auth-config-phase.js");
		expect(() => authConfigPhase()).not.toThrow();
	});

	it("passes when production auth enabled with API key", async () => {
		process.env.NODE_ENV = "production";
		process.env.OSCORPEX_AUTH_ENABLED = "true";
		process.env.OSCORPEX_API_KEY = "api-key-value";
		delete process.env.OSCORPEX_JWT_SECRET;
		const { authConfigPhase } = await import("../../boot-phases/auth-config-phase.js");
		expect(() => authConfigPhase()).not.toThrow();
	});
});
