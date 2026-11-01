// ---------------------------------------------------------------------------
// I0 item 9 / scenario 8, superseded by the round-3 decision: SonarQube scanning is DISABLED until workload
// isolation (I5) can run the scanner outside the kernel. Whatever the env or project settings say, the kernel never
// spawns the scanner (so no token can ever reach argv or a tenant-chosen host) and never calls a Sonar API.
// A fake `npx` on PATH records any spawn; `fetch` is stubbed to record any outbound call.
// ---------------------------------------------------------------------------

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshTmp, makeFakeBin, prependPath, readInvocations } from "./helpers/i0-fakes.js";

vi.setConfig({ testTimeout: 30_000 });

const state = vi.hoisted(() => ({ settings: {} as Record<string, string | undefined> }));
vi.mock("../db.js", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, getProjectSetting: async (_p: string, _c: string, key: string) => state.settings[key] };
});

const TOKEN = "squ_i0_super_secret_token_0123456789";
let work: string;
let record: string;
let restorePath: () => void;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
	work = freshTmp("oscx-i0-sonar-");
	const bin = join(work, "bin");
	mkdirSync(bin);
	record = makeFakeBin(bin, "npx", { stdout: "ok" });
	writeFileSync(join(work, "sonar-project.properties"), "sonar.projectKey=x\n");
	restorePath = prependPath(bin);
	for (const k of ["SONAR_ENABLED", "SONAR_TOKEN", "SONAR_HOST_URL"]) saved[k] = process.env[k];
	process.env.SONAR_ENABLED = "true";
	process.env.SONAR_TOKEN = TOKEN;
	process.env.SONAR_HOST_URL = "http://localhost:9000";
	state.settings = { enabled: "true", hostUrl: "https://sonar.tenant.example", token: "squ_tenant" };
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
	restorePath();
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
	rmSync(work, { recursive: true, force: true });
});

describe("SonarQube is disabled until workload isolation", () => {
	it("isSonarEnabled is false even with SONAR_ENABLED=true and project settings enabled", async () => {
		const { isSonarEnabled } = await import("../sonar-runner.js");
		expect(await isSonarEnabled()).toBe(false);
		expect(await isSonarEnabled("p1")).toBe(false);
	});

	it("runSonarScan never spawns the scanner (with or without a project id)", async () => {
		const { runSonarScan } = await import("../sonar-runner.js");
		await runSonarScan(work);
		await runSonarScan(work, undefined, "p1");
		expect(readInvocations(record)).toEqual([]);
	});

	it("fetchQualityGate makes no outbound call and reports NONE", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const { fetchQualityGate } = await import("../sonar-runner.js");
		expect((await fetchQualityGate("x", "p1")).status).toBe("NONE");
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
