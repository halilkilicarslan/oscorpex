import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { artifactReferenceService } from "../artifact-reference-service.js";
import { execute, query, queryOne } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM artifact_references LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available or schema missing */
}

const prefix = `artifact-svc-${randomUUID()}`;
let counter = 0;

async function createGoal(options: { tenant?: boolean } = {}) {
	counter += 1;
	const suffix = `${prefix}-${counter}`;
	const tenantId = options.tenant === false ? null : `tenant-${suffix}`;
	if (tenantId) {
		await execute("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [
			tenantId,
			`Tenant ${suffix}`,
			`tenant-${suffix}`,
		]);
	}
	const projectId = `project-${suffix}`;
	await execute(
		`
		INSERT INTO projects (id, name, description, status, tech_stack, repo_path, tenant_id, created_at, updated_at)
		VALUES ($1, $2, '', 'planning', '[]', '', $3, now(), now())
		`,
		[projectId, `Project ${suffix}`, tenantId],
	);
	const goalId = `goal-${suffix}`;
	await execute("INSERT INTO execution_goals (id, project_id, definition, status) VALUES ($1, $2, $3, 'running')", [
		goalId,
		projectId,
		JSON.stringify({ title: `Goal ${suffix}` }),
	]);
	const releaseCandidateId = `rc-${suffix}`;
	await execute(
		`
		INSERT INTO release_candidates (
		  id, tenant_id, project_id, goal_ids, target_environment, state,
		  requested_by, policy_version, correlation_id
		)
		VALUES ($1, $2, $3, $4, 'production', 'candidate', 'artifact-reference-service-test', '1', $5)
		`,
		[releaseCandidateId, tenantId, projectId, JSON.stringify([goalId]), randomUUID()],
	);
	return { tenantId, projectId, goalId, releaseCandidateId, suffix };
}

async function registerAndVerify(goal: { goalId: string; tenantId: string | null }, artifactType: string) {
	const reg = await artifactReferenceService.registerArtifact({
		goalId: goal.goalId,
		tenantId: goal.tenantId,
		artifactType,
		title: `${artifactType} title`,
		uri: `artifact://${artifactType}/${randomUUID()}`,
		checksum: randomUUID(),
		createdBy: "artifact-reference-service-test",
		environment: "production",
	});
	return artifactReferenceService.verifyArtifact({
		artifactId: reg.id,
		verifiedBy: "artifact-reference-service-test-verifier",
	});
}

describe.skipIf(!dbReady)("ArtifactReferenceService", () => {
	beforeEach(async () => {
		await execute("DELETE FROM artifact_references WHERE produced_by = 'artifact-reference-service-test'");
	});

	it("append-only artifact versioning", async () => {
		const goal = await createGoal();
		const v1 = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "test_report",
			title: "v1",
			uri: "artifact://test/v1",
			checksum: "sha-v1",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});
		const v2 = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "test_report",
			title: "v2",
			uri: "artifact://test/v2",
			checksum: "sha-v2",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});

		const rows = await query<{ id: string; superseded_at: string | null }>(
			"SELECT id, superseded_at FROM artifact_references WHERE goal_id = $1 AND artifact_type = 'test_report' ORDER BY created_at ASC",
			[goal.goalId],
		);
		expect(rows.length).toBe(2);
		expect(rows[0].id).toBe(v1.id);
		expect(rows[0].superseded_at).toBeTruthy();
		expect(rows[1].id).toBe(v2.id);
		expect(rows[1].superseded_at).toBeNull();
	});

	it("latest artifact resolution", async () => {
		const goal = await createGoal();
		await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "diff_report",
			title: "old",
			uri: "artifact://diff/old",
			checksum: "old",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});
		const latest = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "diff_report",
			title: "new",
			uri: "artifact://diff/new",
			checksum: "new",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});
		const state = await artifactReferenceService.resolveArtifactState(goal.goalId);
		const selected = state.latestArtifacts.find((a) => a.artifactType === "diff_report");
		expect(selected?.id).toBe(latest.id);
	});

	it("required artifact missing -> blocked", async () => {
		const goal = await createGoal();
		await registerAndVerify(goal, "test_report");
		const state = await artifactReferenceService.isArtifactCompletenessSatisfied(goal.goalId);
		expect(state.satisfied).toBe(false);
		expect(state.missingArtifacts.length).toBeGreaterThan(0);
	});

	it("rejected artifact -> blocked", async () => {
		const goal = await createGoal();
		const reg = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "review_summary",
			title: "review",
			uri: "artifact://review",
			checksum: "review",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});
		await artifactReferenceService.rejectArtifact({
			artifactId: reg.id,
			rejectedBy: "artifact-reference-service-test-reviewer",
			reason: "invalid content",
		});
		const state = await artifactReferenceService.resolveArtifactState(goal.goalId);
		expect(state.satisfied).toBe(false);
		expect(state.rejectedArtifacts.some((a) => a.artifactType === "review_summary")).toBe(true);
	});

	it("verified artifacts -> completeness satisfied", async () => {
		const goal = await createGoal();
		const required = await artifactReferenceService.getRequiredArtifacts(goal.goalId);
		for (const type of required) {
			await registerAndVerify(goal, type);
		}
		const state = await artifactReferenceService.resolveArtifactState(goal.goalId);
		expect(state.satisfied).toBe(true);
		expect(state.missingArtifacts).toEqual([]);
	});

	it("stale artifact detection", async () => {
		const goal = await createGoal();
		const oldTs = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		await execute(
			`
			INSERT INTO artifact_references (
			  id, tenant_id, project_id, goal_id, artifact_type, title, status, location,
			  digest, produced_by, policy_version, correlation_id, produced_at, verified_at, metadata
			)
			VALUES ($1, $2, $3, $4, 'test_report', 'stale report', 'verified', 'artifact://stale',
			  'stale', 'artifact-reference-service-test', '1', $5, $6, $6, '{}')
			`,
			[randomUUID(), goal.tenantId, goal.projectId, goal.goalId, randomUUID(), oldTs],
		);
		const state = await artifactReferenceService.resolveArtifactState(goal.goalId);
		expect(state.staleArtifacts.some((a) => a.artifactType === "test_report")).toBe(true);
	});

	it("production tenant missing -> deny", async () => {
		const goal = await createGoal({ tenant: false });
		await expect(
			artifactReferenceService.registerArtifact({
				goalId: goal.goalId,
				tenantId: null,
				artifactType: "test_report",
				title: "x",
				environment: "production",
			}),
		).rejects.toThrow();
	});

	it("superseded artifact invalidates prior version", async () => {
		const goal = await createGoal();
		const reg = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "deployment_plan",
			title: "dep v1",
			uri: "artifact://dep/v1",
			checksum: "dep-v1",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});
		await artifactReferenceService.supersedeArtifact({
			artifactId: reg.id,
			supersededBy: "artifact-reference-service-test-operator",
			reason: "new version incoming",
		});
		const row = await queryOne<{ superseded_at: string | null }>(
			"SELECT superseded_at FROM artifact_references WHERE id = $1",
			[reg.id],
		);
		expect(row?.superseded_at).toBeTruthy();
	});

	it("audit events emitted", async () => {
		const goal = await createGoal();
		const reg = await artifactReferenceService.registerArtifact({
			goalId: goal.goalId,
			tenantId: goal.tenantId,
			artifactType: "approval_evidence",
			title: "approval evidence",
			uri: "artifact://approval",
			checksum: "approval",
			createdBy: "artifact-reference-service-test",
			environment: "production",
		});
		await artifactReferenceService.verifyArtifact({
			artifactId: reg.id,
			verifiedBy: "artifact-reference-service-test-verifier",
		});
		await artifactReferenceService.resolveArtifactState(goal.goalId);

		const registered = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'artifact.registered' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		const verified = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'artifact.verified' ORDER BY timestamp DESC LIMIT 1",
			[goal.projectId],
		);
		expect(registered?.id).toBeTruthy();
		expect(verified?.id).toBeTruthy();
	});
});

