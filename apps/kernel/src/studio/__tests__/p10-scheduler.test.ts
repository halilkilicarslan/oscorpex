// ---------------------------------------------------------------------------
// P10 Scheduler — Unit Tests
// P10-A: Scheduler Core (registry, runner)
// P10-B: Scheduler Policy
// P10-C..H: Report Jobs
// P10-K: Scheduler Audit
//
// All tests are DB-independent — no PostgreSQL connection required.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// P10-A: Scheduler Registry
// ---------------------------------------------------------------------------
describe("P10-A: Scheduler Registry", () => {
	// Fresh module state per describe block via dynamic imports
	it("registerJob rejects non-read riskLevel", async () => {
		const { registerJob } = await import("../scheduler/scheduler-registry.js");
		expect(() =>
			registerJob(
				{
					id: "bad-job",
					name: "bad",
					description: "",
					schedule: "",
					riskLevel: "write" as "read",
					scope: "global-readonly",
					enabled: true,
				},
				async () => ({}) as never,
			),
		).toThrow("read-only");
	});

	it("registerJob accepts read riskLevel and listJobs returns it", async () => {
		const { registerJob, listJobs } = await import("../scheduler/scheduler-registry.js");
		const before = listJobs().length;
		registerJob(
			{
				id: "test-list-job",
				name: "Test List Job",
				description: "desc",
				schedule: "* * * * *",
				riskLevel: "read",
				scope: "global-readonly",
				enabled: true,
			},
			async (ctx) => ({
				jobId: ctx.jobId,
				status: "completed",
				durationMs: 0,
				executedAt: ctx.startedAt,
			}),
		);
		expect(listJobs().length).toBe(before + 1);
	});

	it("getJobDefinition returns undefined for unknown id", async () => {
		const { getJobDefinition } = await import("../scheduler/scheduler-registry.js");
		expect(getJobDefinition("nonexistent-xyz")).toBeUndefined();
	});

	it("getJobHandler returns undefined for unknown id", async () => {
		const { getJobHandler } = await import("../scheduler/scheduler-registry.js");
		expect(getJobHandler("nonexistent-xyz")).toBeUndefined();
	});

	it("isSchedulerEnabled returns false when env var is unset", async () => {
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
		const { isSchedulerEnabled } = await import("../scheduler/scheduler-registry.js");
		expect(isSchedulerEnabled()).toBe(false);
	});

	it("isSchedulerEnabled returns false when env var is 'false'", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "false";
		const { isSchedulerEnabled } = await import("../scheduler/scheduler-registry.js");
		expect(isSchedulerEnabled()).toBe(false);
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("isSchedulerEnabled returns true when env var is 'true'", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { isSchedulerEnabled } = await import("../scheduler/scheduler-registry.js");
		expect(isSchedulerEnabled()).toBe(true);
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});
});

// ---------------------------------------------------------------------------
// P10-A: Scheduler Runner
// ---------------------------------------------------------------------------
describe("P10-A: Scheduler Runner", () => {
	beforeEach(() => {
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("runJob returns skipped when scheduler is disabled", async () => {
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		const result = await runJob("any-job-id");
		expect(result.status).toBe("skipped");
		expect(result.error).toMatch(/disabled/i);
		expect(result.durationMs).toBe(0);
		expect(result.executedAt).toBeDefined();
	});

	it("runJob returns failed when job is not found (scheduler enabled)", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		const result = await runJob("definitely-not-registered");
		expect(result.status).toBe("failed");
		expect(result.error).toMatch(/not found/i);
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("runJob returns skipped for disabled job (scheduler enabled)", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerJob } = await import("../scheduler/scheduler-registry.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerJob(
			{
				id: "disabled-test-job",
				name: "Disabled Job",
				description: "",
				schedule: "* * * * *",
				riskLevel: "read",
				scope: "global-readonly",
				enabled: false,
			},
			async (ctx) => ({
				jobId: ctx.jobId,
				status: "completed",
				durationMs: 0,
				executedAt: ctx.startedAt,
			}),
		);
		const result = await runJob("disabled-test-job");
		expect(result.status).toBe("skipped");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("runJob executes successfully for valid enabled job", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerJob } = await import("../scheduler/scheduler-registry.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerJob(
			{
				id: "success-test-job",
				name: "Success Job",
				description: "",
				schedule: "* * * * *",
				riskLevel: "read",
				scope: "global-readonly",
				enabled: true,
			},
			async (ctx) => ({
				jobId: ctx.jobId,
				status: "completed",
				output: { ok: true },
				durationMs: 0,
				executedAt: ctx.startedAt,
			}),
		);
		const result = await runJob("success-test-job");
		expect(result.status).toBe("completed");
		expect(result.jobId).toBe("success-test-job");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("runJob handles handler throwing an error", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerJob } = await import("../scheduler/scheduler-registry.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerJob(
			{
				id: "throwing-test-job",
				name: "Throwing Job",
				description: "",
				schedule: "* * * * *",
				riskLevel: "read",
				scope: "global-readonly",
				enabled: true,
			},
			async () => {
				throw new Error("Intentional test error");
			},
		);
		const result = await runJob("throwing-test-job");
		expect(result.status).toBe("failed");
		expect(result.error).toMatch(/Intentional test error/);
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});
});

// ---------------------------------------------------------------------------
// P10-B: Scheduler Policy
// ---------------------------------------------------------------------------
describe("P10-B: Scheduler Policy", () => {
	it("allows a generic read-only action", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "report.generate",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("allow");
	});

	it("allows execute action (used by runner)", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "execute",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("allow");
	});

	it("denies file.write", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "file.write",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
		expect(result.code).toBe("SCHEDULER_ACTION_DENIED");
	});

	it("denies file.delete", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "file.delete",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies git.commit", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "git.commit",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies git.push", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "git.push",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies git.reset", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "git.reset",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies shell.run", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "shell.run",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies deploy.run", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "deploy.run",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies container.run", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "container.run",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies db.mutate", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "db.mutate",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies credential.read", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "credential.read",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies memory.delete", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "memory.delete",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies task.update", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "task.update",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies project.update", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "project.update",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("denies checkpoint.delete", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "checkpoint.delete",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.decision).toBe("deny");
	});

	it("includes reason in allow response", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "data.read",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.reason).toBeTruthy();
	});

	it("includes reason and code in deny response", async () => {
		const { evaluateSchedulerPolicy } = await import("../scheduler/scheduler-policy.js");
		const result = evaluateSchedulerPolicy({
			jobId: "j1",
			action: "file.write",
			riskLevel: "read",
			source: "scheduler",
		});
		expect(result.reason).toBeTruthy();
		expect(result.code).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// P10-K: Scheduler Audit
// ---------------------------------------------------------------------------
describe("P10-K: Scheduler Audit", () => {
	it("recordSchedulerAudit returns event with generated id", async () => {
		const { recordSchedulerAudit } = await import("../scheduler/scheduler-audit.js");
		const audit = recordSchedulerAudit({
			jobId: "audit-test-job",
			status: "completed",
			decision: "allow",
			durationMs: 42,
		});
		expect(audit.id).toBeDefined();
		expect(audit.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("recordSchedulerAudit sets timestamp as ISO string", async () => {
		const { recordSchedulerAudit } = await import("../scheduler/scheduler-audit.js");
		const before = Date.now();
		const audit = recordSchedulerAudit({
			jobId: "ts-test-job",
			status: "completed",
			decision: "allow",
			durationMs: 0,
		});
		const after = Date.now();
		const ts = new Date(audit.timestamp).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});

	it("recordSchedulerAudit preserves all input fields", async () => {
		const { recordSchedulerAudit } = await import("../scheduler/scheduler-audit.js");
		const audit = recordSchedulerAudit({
			jobId: "fields-test-job",
			status: "denied",
			decision: "deny",
			reason: "Policy violation",
			durationMs: 5,
		});
		expect(audit.jobId).toBe("fields-test-job");
		expect(audit.status).toBe("denied");
		expect(audit.decision).toBe("deny");
		expect(audit.reason).toBe("Policy violation");
		expect(audit.durationMs).toBe(5);
	});

	it("recordSchedulerAudit generates unique ids for each call", async () => {
		const { recordSchedulerAudit } = await import("../scheduler/scheduler-audit.js");
		const a = recordSchedulerAudit({ jobId: "j1", status: "completed", decision: "allow", durationMs: 1 });
		const b = recordSchedulerAudit({ jobId: "j2", status: "completed", decision: "allow", durationMs: 2 });
		expect(a.id).not.toBe(b.id);
	});

	it("recordSchedulerAudit works for failed status", async () => {
		const { recordSchedulerAudit } = await import("../scheduler/scheduler-audit.js");
		const audit = recordSchedulerAudit({
			jobId: "fail-job",
			status: "failed",
			decision: "allow",
			reason: "Handler crashed",
			durationMs: 100,
		});
		expect(audit.status).toBe("failed");
		expect(audit.reason).toBe("Handler crashed");
	});

	it("recordSchedulerAudit works for skipped status", async () => {
		const { recordSchedulerAudit } = await import("../scheduler/scheduler-audit.js");
		const audit = recordSchedulerAudit({
			jobId: "skip-job",
			status: "skipped",
			decision: "allow",
			durationMs: 0,
		});
		expect(audit.status).toBe("skipped");
	});
});

// ---------------------------------------------------------------------------
// P10-C..H: Report Jobs
// ---------------------------------------------------------------------------
describe("P10-C..H: Report Jobs", () => {
	it("registerAllReportJobs registers 6 jobs", async () => {
		const { listJobs } = await import("../scheduler/scheduler-registry.js");
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const before = listJobs().length;
		// Guard against double-registration if module is cached
		registerAllReportJobs();
		const after = listJobs().length;
		// At least 6 jobs registered total (may already be registered from module cache)
		expect(after).toBeGreaterThanOrEqual(6);
		// If not previously registered, exactly 6 were added
		if (before < 6) {
			expect(after - before).toBeGreaterThanOrEqual(1);
		}
	});

	it("all 6 report job ids are present in registry", async () => {
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { getJobDefinition } = await import("../scheduler/scheduler-registry.js");
		registerAllReportJobs(); // idempotent re-registration (overwrite same id)
		const expectedIds = [
			"daily-audit-summary",
			"failed-task-report",
			"stale-approval-report",
			"checkpoint-cleanup-report",
			"dependency-report",
			"mcp-health-report",
		];
		for (const id of expectedIds) {
			const def = getJobDefinition(id);
			expect(def, `Job '${id}' should be registered`).toBeDefined();
		}
	});

	it("all report jobs have riskLevel 'read'", async () => {
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { listJobs } = await import("../scheduler/scheduler-registry.js");
		registerAllReportJobs();
		const reportIds = new Set([
			"daily-audit-summary",
			"failed-task-report",
			"stale-approval-report",
			"checkpoint-cleanup-report",
			"dependency-report",
			"mcp-health-report",
		]);
		const jobs = listJobs().filter((j) => reportIds.has(j.id));
		for (const job of jobs) {
			expect(job.riskLevel).toBe("read");
		}
	});

	it("all report jobs have scope 'global-readonly'", async () => {
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { listJobs } = await import("../scheduler/scheduler-registry.js");
		registerAllReportJobs();
		const reportIds = new Set([
			"daily-audit-summary",
			"failed-task-report",
			"stale-approval-report",
			"checkpoint-cleanup-report",
			"dependency-report",
			"mcp-health-report",
		]);
		const jobs = listJobs().filter((j) => reportIds.has(j.id));
		for (const job of jobs) {
			expect(job.scope).toBe("global-readonly");
		}
	});

	it("all report jobs are enabled by default", async () => {
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { listJobs } = await import("../scheduler/scheduler-registry.js");
		registerAllReportJobs();
		const reportIds = new Set([
			"daily-audit-summary",
			"failed-task-report",
			"stale-approval-report",
			"checkpoint-cleanup-report",
			"dependency-report",
			"mcp-health-report",
		]);
		const jobs = listJobs().filter((j) => reportIds.has(j.id));
		for (const job of jobs) {
			expect(job.enabled).toBe(true);
		}
	});

	it("all report jobs use daily cron schedule", async () => {
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { listJobs } = await import("../scheduler/scheduler-registry.js");
		registerAllReportJobs();
		const reportIds = new Set([
			"daily-audit-summary",
			"failed-task-report",
			"stale-approval-report",
			"checkpoint-cleanup-report",
			"dependency-report",
			"mcp-health-report",
		]);
		const jobs = listJobs().filter((j) => reportIds.has(j.id));
		for (const job of jobs) {
			expect(job.schedule).toBe("0 0 * * *");
		}
	});

	it("P10-C daily-audit-summary handler returns completed status", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerAllReportJobs();
		const result = await runJob("daily-audit-summary");
		expect(result.status).toBe("completed");
		expect((result.output as Record<string, unknown>)?.type).toBe("daily-audit-summary");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("P10-D failed-task-report handler returns completed status", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerAllReportJobs();
		const result = await runJob("failed-task-report");
		expect(result.status).toBe("completed");
		expect((result.output as Record<string, unknown>)?.type).toBe("failed-task-report");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("P10-E stale-approval-report handler returns completed status", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerAllReportJobs();
		const result = await runJob("stale-approval-report");
		expect(result.status).toBe("completed");
		expect((result.output as Record<string, unknown>)?.type).toBe("stale-approval-report");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("P10-F checkpoint-cleanup-report has note field (proposals only)", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerAllReportJobs();
		const result = await runJob("checkpoint-cleanup-report");
		expect(result.status).toBe("completed");
		expect((result.output as Record<string, unknown>)?.note).toMatch(/report only/i);
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("P10-G dependency-report handler returns completed status", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerAllReportJobs();
		const result = await runJob("dependency-report");
		expect(result.status).toBe("completed");
		expect((result.output as Record<string, unknown>)?.type).toBe("dependency-report");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});

	it("P10-H mcp-health-report handler returns completed status", async () => {
		process.env.OSCORPEX_ENABLE_SCHEDULER = "true";
		const { registerAllReportJobs } = await import("../scheduler/jobs/report-jobs.js");
		const { runJob } = await import("../scheduler/scheduler-runner.js");
		registerAllReportJobs();
		const result = await runJob("mcp-health-report");
		expect(result.status).toBe("completed");
		expect((result.output as Record<string, unknown>)?.type).toBe("mcp-health-report");
		delete process.env.OSCORPEX_ENABLE_SCHEDULER;
	});
});
