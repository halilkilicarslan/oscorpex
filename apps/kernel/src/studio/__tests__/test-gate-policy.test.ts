import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
	getProjectSetting: vi.fn().mockResolvedValue(null),
	saveTestResult: vi.fn(),
}));

import { resolveTestPolicy } from "../test-gate.js";

describe("test gate policy", () => {
	it("honors explicit testExpectation override", async () => {
		const policy = await resolveTestPolicy(
			"p1",
			{
				id: "t0",
				phaseId: "ph1",
				title: "Scaffold project shell",
				description: "Initial setup",
				assignedAgent: "frontend-dev",
				status: "queued",
				complexity: "S",
				dependsOn: [],
				branch: "main",
				retryCount: 0,
				revisionCount: 0,
				requiresApproval: false,
				testExpectation: "none",
			},
			"frontend-dev",
		);
		expect(policy).toBe("skip");
	});

	it("marks bootstrap/setup tasks as optional", async () => {
		const policy = await resolveTestPolicy(
			"p1",
			{
				id: "t1",
				phaseId: "ph1",
				title: "Initialize Vite + React + TypeScript project",
				description: "Create base setup and configure tsconfig/package.json",
				assignedAgent: "frontend-dev",
				status: "queued",
				complexity: "S",
				dependsOn: [],
				branch: "main",
				retryCount: 0,
				revisionCount: 0,
				requiresApproval: false,
			},
			"frontend-dev",
		);
		expect(policy).toBe("optional");
	});

	it("keeps normal coding tasks required for coding roles", async () => {
		const policy = await resolveTestPolicy(
			"p1",
			{
				id: "t2",
				phaseId: "ph1",
				title: "Implement auth token refresh flow",
				description: "Add middleware and refresh token endpoint",
				assignedAgent: "backend-dev",
				status: "queued",
				complexity: "M",
				dependsOn: [],
				branch: "main",
				retryCount: 0,
				revisionCount: 0,
				requiresApproval: false,
			},
			"backend-dev",
		);
		expect(policy).toBe("required");
	});
});
