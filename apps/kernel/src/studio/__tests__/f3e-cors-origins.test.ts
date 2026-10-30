// ---------------------------------------------------------------------------
// F3-e review fix round 1, item 6 — CORS origin allowlist: default set and one-time parsing.
// Assumed: getAllowedOrigins() memoizes the parse keyed by the raw OSCORPEX_CORS_ORIGINS string, so a changed env
// is still honoured per call but an unchanged one is not re-parsed (and does not re-log its warnings).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
let saved: string | undefined;

async function freshModule() {
	vi.resetModules();
	warn.mockClear();
	vi.doMock("../logger.js", () => ({
		createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
	}));
	return import("../auth/cors-origins.js");
}

beforeEach(() => {
	saved = process.env.OSCORPEX_CORS_ORIGINS;
	Reflect.deleteProperty(process.env, "OSCORPEX_CORS_ORIGINS");
});
afterEach(() => {
	vi.doUnmock("../logger.js");
	vi.resetModules();
	if (saved === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_CORS_ORIGINS");
	else process.env.OSCORPEX_CORS_ORIGINS = saved;
});

describe("default allowlist", () => {
	it("includes the console on both loopback spellings", async () => {
		const { getAllowedOrigins } = await freshModule();
		const origins = getAllowedOrigins();
		expect(origins).toContain("http://localhost:5161");
		expect(origins).toContain("http://127.0.0.1:5161");
		expect(origins).toContain("http://localhost:5173");
	});

	it("excludes the preview port that serves untrusted code", async () => {
		const { getAllowedOrigins } = await freshModule();
		const joined = getAllowedOrigins().join(",");
		expect(joined).not.toContain(":4242");
	});
});

describe("memoized parsing", () => {
	it("rejected entries warn once across repeated calls with the same env", async () => {
		const { getAllowedOrigins } = await freshModule();
		process.env.OSCORPEX_CORS_ORIGINS = "*,not a url,http://localhost:5161";
		for (let i = 0; i < 5; i++) expect(getAllowedOrigins()).toEqual(["http://localhost:5161"]);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it("a changed env value is re-parsed", async () => {
		const { getAllowedOrigins } = await freshModule();
		process.env.OSCORPEX_CORS_ORIGINS = "https://a.example.com";
		expect(getAllowedOrigins()).toEqual(["https://a.example.com"]);
		process.env.OSCORPEX_CORS_ORIGINS = "https://b.example.com";
		expect(getAllowedOrigins()).toEqual(["https://b.example.com"]);
	});
});
