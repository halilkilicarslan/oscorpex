// ---------------------------------------------------------------------------
// F2 round 3 (final items), E — platform-admin project import applies the system-path blocklist to BOTH the raw
// and the realpath-resolved path. On macOS /etc → /private/etc, /var → /private/var, /tmp → /private/tmp, so
// /private/* is blocked as well. Lint/Sonar config writes are mocked; nothing is written to the filesystem.
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sideEffects = vi.hoisted(() => ({ lint: [] as string[], sonar: [] as string[] }));
vi.mock("../lint-runner.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lint-runner.js")>();
	return {
		...actual,
		initLintConfig: async (p: string) => {
			sideEffects.lint.push(p);
		},
	};
});
vi.mock("../sonar-runner.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../sonar-runner.js")>();
	return {
		...actual,
		isSonarEnabled: async () => true,
		initSonarConfig: async (p: string) => {
			sideEffects.sonar.push(p);
		},
	};
});

import { validateRepoPath } from "../security/workspace-resolver.js";
import { call, cleanup, mkUser, registerCleanup, useAuthEnabledEnv } from "./helpers/f2r3-fixtures.js";
import type { SeededUser } from "./helpers/identity.js";
import { TENANT_A } from "./helpers/tenancy.js";

useAuthEnabledEnv();
registerCleanup();

let platformAdmin: SeededUser;
let linkDir: string;
const importedProjects: string[] = [];

beforeAll(async () => {
	platformAdmin = await mkUser({ tenantId: TENANT_A, role: "owner", admin: true });
	// A symlink living in a temp dir (never in $HOME or a system dir) that points at /etc.
	linkDir = mkdtempSync(join(tmpdir(), "f2ae-import-"));
	symlinkSync("/etc", join(linkDir, "etc-link"));
});
afterAll(() => {
	rmSync(linkDir, { recursive: true, force: true });
	cleanup.projects.push(...importedProjects);
});
beforeEach(() => {
	sideEffects.lint.length = 0;
	sideEffects.sonar.length = 0;
});

async function importPath(repoPath: string) {
	const res = await call(platformAdmin, "POST", "/projects/import", { name: "f2ae-import", repoPath });
	const text = await res.text();
	try {
		const id = (JSON.parse(text) as { id?: string }).id;
		if (id) importedProjects.push(id);
	} catch {
		// non-JSON body
	}
	return { status: res.status, text };
}

describe("validateRepoPath blocks the macOS aliases of system directories", () => {
	it.each(["/private/etc", "/private/var", "/private/tmp", "/private/etc/ssh"])("%s is rejected", (p) => {
		expect(() => validateRepoPath(p)).toThrow();
	});
	it("raw system paths stay rejected (control)", () => {
		for (const p of ["/", "/etc", "/usr", "/var", "/tmp", "/bin", "/sbin", "/root"]) {
			expect(() => validateRepoPath(p)).toThrow();
		}
	});
});

describe("POST /projects/import as platform admin", () => {
	it('"/etc" → 400 and no project / lint / sonar side effect', async () => {
		const r = await importPath("/etc");
		expect(r.status).toBe(400);
		expect(sideEffects.lint).toEqual([]);
		expect(sideEffects.sonar).toEqual([]);
	});

	it('"/private/etc" → 400', async () => {
		expect((await importPath("/private/etc")).status).toBe(400);
		expect(sideEffects.lint).toEqual([]);
	});

	it("a temp-dir symlink that resolves to /etc → 400 (realpath is validated, not just the raw path)", async () => {
		const r = await importPath(join(linkDir, "etc-link"));
		expect(r.status).toBe(400);
		expect(sideEffects.lint).toEqual([]);
		expect(sideEffects.sonar).toEqual([]);
	});

	it("the rejection does not echo the resolved path", async () => {
		const r = await importPath(join(linkDir, "etc-link"));
		expect(r.text).not.toContain("/private/etc");
	});
});
