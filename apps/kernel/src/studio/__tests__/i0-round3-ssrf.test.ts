// ---------------------------------------------------------------------------
// I0 round 3 — N5: IP literals are judged by their address, never by DNS. DNS is mocked to fail for every name (the
// "offline" case), which is exactly where an IP literal used to slip through the "unresolvable -> valid" rule.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => {
	const fail = async () => {
		throw Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
	};
	return { resolve4: fail, resolve6: fail, default: { resolve4: fail, resolve6: fail } };
});

import { resolveAndValidateUrl, validateOutboundHostUrl } from "../utils/url-validator.js";

const BLOCKED = [
	"http://[::ffff:127.0.0.1]",
	"http://[::ffff:7f00:1]",
	"http://[::ffff:a00:5]",
	"http://[::ffff:c0a8:101]",
	"http://[fd00::1]",
	"http://[fe80::1]",
	"http://100.64.0.1",
	"http://[::1]",
	"http://0.0.0.0",
	"http://127.0.0.1:9000",
	"http://169.254.169.254",
];

const PUBLIC = ["http://8.8.8.8", "http://[2606:4700::1]"];

describe("validateOutboundHostUrl: private / loopback / mapped / CGNAT literals are rejected", () => {
	for (const url of BLOCKED) {
		it(url, async () => {
			const r = await validateOutboundHostUrl(url);
			expect(r.valid).toBe(false);
			expect(r.reason).not.toBe("unresolved");
		});
	}
});

describe("resolveAndValidateUrl: the same literals are rejected", () => {
	for (const url of BLOCKED) {
		it(url, async () => {
			expect((await resolveAndValidateUrl(url)).valid).toBe(false);
		});
	}
});

describe("public literals still pass (no DNS needed)", () => {
	for (const url of PUBLIC) {
		it(`validateOutboundHostUrl ${url}`, async () => {
			expect((await validateOutboundHostUrl(url)).valid).toBe(true);
		});
		it(`resolveAndValidateUrl ${url}`, async () => {
			expect((await resolveAndValidateUrl(url)).valid).toBe(true);
		});
	}

	it("an unresolvable NAME is still let through by validateOutboundHostUrl (documented behaviour)", async () => {
		expect((await validateOutboundHostUrl("https://sonar.nowhere.invalid")).valid).toBe(true);
	});
});
