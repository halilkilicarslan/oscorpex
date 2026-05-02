import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	ApprovalService,
	InvalidApprovalTransitionError,
	TenantRequiredForProductionApprovalError,
} from "../approval-service.js";
import { execute, query, queryOne } from "../pg.js";

let dbReady = false;
try {
	await query("SELECT 1 FROM approval_requests LIMIT 0");
	dbReady = true;
} catch {
	/* DB not available or schema missing */
}

const service = new ApprovalService();
const prefix = `approval-svc-${randomUUID()}`;
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
	return { tenantId, projectId, goalId, suffix };
}

async function createRequest(
	options: {
		tenant?: boolean;
		requiredQuorum?: number;
		expiresAt?: string;
		approvalType?: string;
	} = {},
) {
	const goal = await createGoal({ tenant: options.tenant });
	const request = await service.createApprovalRequest({
		goalId: goal.goalId,
		tenantId: goal.tenantId,
		approvalType: options.approvalType ?? "human_approval",
		requiredRole: "release-manager",
		requiredQuorum: options.requiredQuorum ?? 1,
		environment: "production",
		expiresAt: options.expiresAt,
		requestedBy: "approval-service-test",
	});
	return { ...goal, request };
}

describe.skipIf(!dbReady)("ApprovalService", () => {
	beforeEach(async () => {
		await execute("DELETE FROM approval_decisions WHERE actor_id LIKE 'approval-service-test%'");
		await execute("DELETE FROM approval_requests WHERE requested_by = 'approval-service-test'");
	});

	it("writes approval decisions append-only", async () => {
		const { request, tenantId } = await createRequest({ requiredQuorum: 2 });
		await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-a",
			actorRoles: ["release-manager"],
		});
		await service.rejectRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-b",
			actorRoles: ["release-manager"],
			reason: "risk not accepted",
		});

		const rows = await query<{ decision: string }>(
			"SELECT decision FROM approval_decisions WHERE approval_request_id = $1 ORDER BY created_at ASC",
			[request.id],
		);
		expect(rows.map((row) => row.decision)).toEqual(["approved", "rejected"]);
	});

	it("applies lifecycle transitions and blocks invalid terminal transition", async () => {
		const { request, tenantId } = await createRequest();
		const approved = await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-a",
			actorRoles: ["release-manager"],
		});
		expect(approved.state).toBe("approved");
		expect(approved.satisfied).toBe(true);

		await expect(
			service.rejectRequest({
				approvalRequestId: request.id,
				tenantId,
				actorId: "approval-service-test-b",
				actorRoles: ["release-manager"],
			}),
		).rejects.toBeInstanceOf(InvalidApprovalTransitionError);
	});

	it("approval expiry invalidates approval satisfaction", async () => {
		const { request, goalId } = await createRequest({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
		const state = await service.resolveApprovalValidity(goalId);
		expect(state.satisfied).toBe(false);
		expect(state.blocked).toBe(true);
		expect(state.expired.some((entry) => entry.request.id === request.id)).toBe(true);
	});

	it("calculates quorum and missing approvals", async () => {
		const { request, tenantId, goalId } = await createRequest({ requiredQuorum: 2 });
		const partial = await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-a",
			actorRoles: ["release-manager"],
		});
		expect(partial.satisfied).toBe(false);
		expect(partial.missingApprovals).toBe(1);

		const satisfied = await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-b",
			actorRoles: ["release-manager"],
		});
		expect(satisfied.satisfied).toBe(true);
		expect(satisfied.approvedCount).toBe(2);
		expect(await service.isApprovalSatisfied(goalId)).toBe(true);
	});

	it("reject blocks approval satisfaction even with approval present", async () => {
		const { request, tenantId, goalId } = await createRequest({ requiredQuorum: 2 });
		await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-a",
			actorRoles: ["release-manager"],
		});
		const rejected = await service.rejectRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-b",
			actorRoles: ["release-manager"],
		});
		expect(rejected.blocked).toBe(true);
		expect(rejected.rejected).toBe(true);
		expect(await service.isApprovalSatisfied(goalId)).toBe(false);
	});

	it("fails closed when production tenant is missing", async () => {
		const goal = await createGoal({ tenant: false });
		await expect(
			service.createApprovalRequest({
				goalId: goal.goalId,
				tenantId: null,
				approvalType: "production_deploy_approval",
				requiredRole: "release-manager",
				requiredQuorum: 1,
				environment: "production",
				requestedBy: "approval-service-test",
			}),
		).rejects.toBeInstanceOf(TenantRequiredForProductionApprovalError);
	});

	it("superseded approval no longer satisfies validity", async () => {
		const { request, tenantId, goalId } = await createRequest();
		await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-a",
			actorRoles: ["release-manager"],
		});
		const superseded = await service.supersedeApprovalRequest(request.id);
		expect(superseded.state).toBe("superseded");
		expect(superseded.satisfied).toBe(false);

		const validity = await service.resolveApprovalValidity(goalId);
		expect(validity.satisfied).toBe(false);
	});

	it("emits audit events", async () => {
		const { request, tenantId, projectId } = await createRequest();
		await service.approveRequest({
			approvalRequestId: request.id,
			tenantId,
			actorId: "approval-service-test-a",
			actorRoles: ["release-manager"],
		});

		const requested = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'approval.requested' ORDER BY timestamp DESC LIMIT 1",
			[projectId],
		);
		const approved = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'approval.approved' ORDER BY timestamp DESC LIMIT 1",
			[projectId],
		);
		const quorum = await queryOne<{ id: string }>(
			"SELECT id FROM events WHERE project_id = $1 AND type = 'approval.quorum_satisfied' ORDER BY timestamp DESC LIMIT 1",
			[projectId],
		);
		expect(requested?.id).toBeTruthy();
		expect(approved?.id).toBeTruthy();
		expect(quorum?.id).toBeTruthy();
	});
});
