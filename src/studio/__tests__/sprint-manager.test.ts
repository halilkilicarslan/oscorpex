import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pg.js", () => ({
	execute: vi.fn(),
	getPool: vi.fn(),
	query: vi.fn(),
	queryOne: vi.fn(),
}));

vi.mock("../db.js", () => ({
	now: () => "2026-04-15T00:00:00.000Z",
	rowToSprint: (row: any) => ({
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		goal: row.goal ?? undefined,
		startDate: row.start_date,
		endDate: row.end_date,
		status: row.status,
		createdAt: row.created_at,
	}),
}));

import { execute, query, queryOne } from "../pg.js";
import {
	calculateBurndown,
	calculateVelocity,
	cancelSprint,
	completeSprint,
	createSprint,
	getSprint,
	getSprintsByProject,
	startSprint,
} from "../sprint-manager.js";

const mockExecute = vi.mocked(execute);
const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

const makeRow = (overrides: Record<string, unknown> = {}) => ({
	id: "s-1",
	project_id: "p-1",
	name: "Sprint 1",
	goal: null,
	start_date: "2026-04-01",
	end_date: "2026-04-15",
	status: "planned",
	created_at: "2026-04-01T00:00:00.000Z",
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	mockExecute.mockResolvedValue(undefined as any);
});

describe("createSprint", () => {
	it("inserts sprint and returns planned status", async () => {
		const sprint = await createSprint("p-1", {
			name: "Sprint 1",
			startDate: "2026-04-01",
			endDate: "2026-04-15",
		});
		expect(sprint.projectId).toBe("p-1");
		expect(sprint.status).toBe("planned");
		expect(sprint.name).toBe("Sprint 1");
		expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO sprints"), expect.any(Array));
	});
});

describe("getSprint / getSprintsByProject", () => {
	it("returns null when sprint not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		expect(await getSprint("nope")).toBeNull();
	});

	it("maps row via rowToSprint", async () => {
		mockQueryOne.mockResolvedValueOnce(makeRow());
		const sprint = await getSprint("s-1");
		expect(sprint?.id).toBe("s-1");
		expect(sprint?.status).toBe("planned");
	});

	it("lists sprints for a project", async () => {
		mockQuery.mockResolvedValueOnce([makeRow({ id: "s-1" }), makeRow({ id: "s-2" })]);
		const sprints = await getSprintsByProject("p-1");
		expect(sprints).toHaveLength(2);
	});
});

describe("startSprint", () => {
	it("throws when sprint not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		await expect(startSprint("nope")).rejects.toThrow(/not found/);
	});

	it("throws when sprint not in planned state", async () => {
		mockQueryOne.mockResolvedValueOnce(makeRow({ status: "active" }));
		await expect(startSprint("s-1")).rejects.toThrow(/not in 'planned'/);
	});

	it("throws when another sprint is already active", async () => {
		mockQueryOne
			.mockResolvedValueOnce(makeRow({ status: "planned" }))
			.mockResolvedValueOnce({ id: "s-2" });
		await expect(startSprint("s-1")).rejects.toThrow(/already has an active/);
	});

	it("updates status to active", async () => {
		mockQueryOne
			.mockResolvedValueOnce(makeRow({ status: "planned" }))
			.mockResolvedValueOnce(null);
		const sprint = await startSprint("s-1");
		expect(sprint.status).toBe("active");
		expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining("status = 'active'"), ["s-1"]);
	});
});

describe("completeSprint / cancelSprint", () => {
	it("completeSprint sets status to completed", async () => {
		mockQueryOne.mockResolvedValueOnce(makeRow({ status: "active" }));
		const sprint = await completeSprint("s-1");
		expect(sprint.status).toBe("completed");
	});

	it("cancelSprint sets status to cancelled", async () => {
		mockQueryOne.mockResolvedValueOnce(makeRow({ status: "active" }));
		const sprint = await cancelSprint("s-1");
		expect(sprint.status).toBe("cancelled");
	});

	it("both throw when sprint not found", async () => {
		mockQueryOne.mockResolvedValue(null);
		await expect(completeSprint("nope")).rejects.toThrow(/not found/);
		await expect(cancelSprint("nope")).rejects.toThrow(/not found/);
	});
});

describe("calculateBurndown", () => {
	it("returns per-day remaining counts", async () => {
		mockQuery.mockResolvedValueOnce([
			{ date: "2026-04-01", remaining: "10" },
			{ date: "2026-04-02", remaining: "7" },
		]);
		const data = await calculateBurndown("s-1");
		expect(data).toEqual([
			{ date: "2026-04-01", remaining: 10 },
			{ date: "2026-04-02", remaining: 7 },
		]);
	});

	it("returns empty array when no data", async () => {
		mockQuery.mockResolvedValueOnce([]);
		expect(await calculateBurndown("s-1")).toEqual([]);
	});
});

describe("calculateVelocity", () => {
	it("returns 0 when no completed sprints exist", async () => {
		mockQuery.mockResolvedValueOnce([]);
		expect(await calculateVelocity("p-1")).toBe(0);
	});

	it("averages completed items across sprints", async () => {
		mockQuery.mockResolvedValueOnce([{ id: "s-1" }, { id: "s-2" }]);
		mockQueryOne.mockResolvedValueOnce({ total: "10", sprint_count: "2" });
		const velocity = await calculateVelocity("p-1");
		expect(velocity).toBe(5);
	});

	it("respects lastN filter", async () => {
		mockQuery.mockResolvedValueOnce([{ id: "s-1" }]);
		mockQueryOne.mockResolvedValueOnce({ total: "8", sprint_count: "1" });
		const velocity = await calculateVelocity("p-1", 1);
		expect(velocity).toBe(8);
		expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT 1"), ["p-1"]);
	});

	it("returns 0 when count aggregate has 0 sprints", async () => {
		mockQuery.mockResolvedValueOnce([{ id: "s-1" }]);
		mockQueryOne.mockResolvedValueOnce({ total: "0", sprint_count: "0" });
		expect(await calculateVelocity("p-1")).toBe(0);
	});
});
