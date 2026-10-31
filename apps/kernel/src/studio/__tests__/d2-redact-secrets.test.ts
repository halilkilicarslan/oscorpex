// ---------------------------------------------------------------------------
// D2 — redactConnectionStrings masks credentials in log/error text.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

async function redact(text: string): Promise<string> {
	const mod = (await import("../redact-secrets.js")) as unknown as {
		redactConnectionStrings?: (t: string) => string;
	};
	expect(typeof mod.redactConnectionStrings, "redact-secrets must export redactConnectionStrings").toBe("function");
	return (mod.redactConnectionStrings as (t: string) => string)(text);
}

describe("redactConnectionStrings", () => {
	for (const scheme of ["postgres", "postgresql", "redis", "http", "https"]) {
		it(`masks the password in ${scheme}:// URLs and keeps user, host, port and database`, async () => {
			const out = await redact(`failed ${scheme}://alice:S3cr3tPw@db.example.com:5432/appdb?sslmode=require now`);
			expect(out).toBe(`failed ${scheme}://alice:***@db.example.com:5432/appdb?sslmode=require now`);
			expect(out).not.toContain("S3cr3tPw");
		});
	}

	it("leaves a URL without a password unchanged", async () => {
		for (const t of ["postgresql://alice@localhost:5432/db", "postgresql://localhost/db"]) {
			expect(await redact(t)).toBe(t);
		}
	});

	it("masks percent-encoded passwords", async () => {
		const out = await redact("postgresql://bob:p%40ss%2Fw%3Ard@host:5432/db");
		expect(out).toBe("postgresql://bob:***@host:5432/db");
	});

	it("masks libpq password key-values", async () => {
		expect(await redact("password=abc host=x")).toBe("password=*** host=x");
		expect(await redact("host=x password=abc dbname=y")).toBe("host=x password=*** dbname=y");
	});

	it("masks every occurrence", async () => {
		const out = await redact("a postgres://u1:pw1@h1/db and redis://u2:pw2@h2:6379 plus password=pw3 end");
		expect(out).toBe("a postgres://u1:***@h1/db and redis://u2:***@h2:6379 plus password=*** end");
		for (const pw of ["pw1", "pw2", "pw3"]) expect(out).not.toContain(pw);
	});

	it("leaves text without secrets unchanged", async () => {
		const t = "connect ECONNREFUSED 127.0.0.1:5432 (init.sql missing)";
		expect(await redact(t)).toBe(t);
		expect(await redact("")).toBe("");
	});

	it("is idempotent", async () => {
		const once = await redact("postgresql://u:pw@h:1/db password=zzz");
		expect(await redact(once)).toBe(once);
	});

	it("masks a password containing a raw @", async () => {
		const out = await redact("failed postgresql://u:p@ss@h/db now");
		expect(out).not.toContain("p@ss");
		expect(out).not.toContain("ss@h");
		expect(out).toContain("postgresql://u:");
		expect(out).toContain("@h/db");
	});

	it("masks a password with an empty user", async () => {
		const out = await redact("postgresql://:pw@h/db");
		expect(out).not.toContain("pw");
		expect(out).toContain("@h/db");
	});

	it("masks libpq quoted passwords, with and without spaces around =", async () => {
		for (const t of ["password='a b' host=x", "password = 'a b' host=x"]) {
			const out = await redact(t);
			expect(out, t).not.toContain("a b");
			expect(out, t).not.toContain("b'");
			expect(out, t).toContain("host=x");
		}
	});

	it("masks PGPASSWORD and sslpassword", async () => {
		for (const t of ["PGPASSWORD=secret", "sslpassword=secret", "env PGPASSWORD=secret host=x"]) {
			expect(await redact(t), t).not.toContain("secret");
		}
	});
});
