// ---------------------------------------------------------------------------
// Oscorpex — Plugin Repo Tests (M5)
// Tests for DB CRUD functions in plugin-repo.ts
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the pg module before importing plugin-repo
vi.mock("../pg.js", () => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
}));

import * as pg from "../pg.js";
import {
	deletePlugin,
	getPlugin,
	getPluginExecutions,
	insertPluginExecution,
	listPlugins,
	registerPlugin,
	updatePlugin,
} from "../db/plugin-repo.js";

const mockQuery = vi.mocked(pg.query);
const mockQueryOne = vi.mocked(pg.queryOne);
const mockExecute = vi.mocked(pg.execute);

// ---------------------------------------------------------------------------
// Sample row data (snake_case, as returned from PostgreSQL)
// ---------------------------------------------------------------------------

const samplePluginRow = {
	id: "plugin-id-1",
	name: "my-plugin",
	version: "1.0.0",
	description: "A test plugin",
	author: "tester",
	enabled: true,
	hooks: ["task:completed", "pipeline:completed"],
	permissions: ["read:tasks"],
	config_json: { retries: 3 },
	manifest_json: { name: "my-plugin", hooks: ["task:completed"] },
	created_at: "2026-04-19T00:00:00Z",
	updated_at: "2026-04-19T00:00:00Z",
};

const sampleExecutionRow = {
	id: "exec-id-1",
	plugin_name: "my-plugin",
	hook: "task:completed",
	project_id: "proj-1",
	duration_ms: 42,
	success: true,
	error: null,
	created_at: "2026-04-19T00:00:00Z",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("listPlugins", () => {
	it("calls query with correct SQL and maps rows", async () => {
		mockQuery.mockResolvedValueOnce([samplePluginRow]);

		const result = await listPlugins();

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("SELECT * FROM registered_plugins"),
			[],
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: "plugin-id-1",
			name: "my-plugin",
			version: "1.0.0",
			enabled: true,
			hooks: ["task:completed", "pipeline:completed"],
			configJson: { retries: 3 },
		});
	});

	it("returns empty array when no plugins exist", async () => {
		mockQuery.mockResolvedValueOnce([]);
		const result = await listPlugins();
		expect(result).toEqual([]);
	});
});

describe("getPlugin", () => {
	it("calls queryOne with name parameter and maps row", async () => {
		mockQueryOne.mockResolvedValueOnce(samplePluginRow);

		const result = await getPlugin("my-plugin");

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("WHERE name = $1"),
			["my-plugin"],
		);
		expect(result).not.toBeNull();
		expect(result?.name).toBe("my-plugin");
		expect(result?.author).toBe("tester");
	});

	it("returns null when plugin not found", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		const result = await getPlugin("nonexistent");
		expect(result).toBeNull();
	});
});

describe("registerPlugin", () => {
	it("calls queryOne with INSERT ... ON CONFLICT DO UPDATE and returns mapped row", async () => {
		mockQueryOne.mockResolvedValueOnce(samplePluginRow);

		const result = await registerPlugin({
			name: "my-plugin",
			version: "1.0.0",
			description: "A test plugin",
			author: "tester",
			hooks: ["task:completed"],
			permissions: ["read:tasks"],
			config: { retries: 3 },
			manifest: { name: "my-plugin" },
		});

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO registered_plugins"),
			expect.arrayContaining(["my-plugin", "1.0.0"]),
		);
		expect(result.name).toBe("my-plugin");
	});
});

describe("updatePlugin", () => {
	it("builds UPDATE query for enabled field", async () => {
		mockQueryOne.mockResolvedValueOnce({ ...samplePluginRow, enabled: false });

		const result = await updatePlugin("my-plugin", { enabled: false });

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE registered_plugins"),
			expect.arrayContaining([false, "my-plugin"]),
		);
		expect(result?.enabled).toBe(false);
	});

	it("builds UPDATE query for configJson field", async () => {
		mockQueryOne.mockResolvedValueOnce(samplePluginRow);

		await updatePlugin("my-plugin", { configJson: { timeout: 1000 } });

		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE registered_plugins"),
			expect.arrayContaining(['{"timeout":1000}', "my-plugin"]),
		);
	});

	it("returns null when plugin not found after update", async () => {
		mockQueryOne.mockResolvedValueOnce(null);
		const result = await updatePlugin("ghost", { enabled: true });
		expect(result).toBeNull();
	});

	it("calls getPlugin when no fields provided", async () => {
		mockQueryOne.mockResolvedValueOnce(samplePluginRow);
		// No fields → falls through to getPlugin
		await updatePlugin("my-plugin", {});
		expect(mockQueryOne).toHaveBeenCalledWith(
			expect.stringContaining("WHERE name = $1"),
			["my-plugin"],
		);
	});
});

describe("deletePlugin", () => {
	it("calls execute with DELETE statement", async () => {
		mockExecute.mockResolvedValueOnce(undefined as any);

		await deletePlugin("my-plugin");

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("DELETE FROM registered_plugins"),
			["my-plugin"],
		);
	});
});

describe("insertPluginExecution", () => {
	it("calls execute with INSERT statement and all fields", async () => {
		mockExecute.mockResolvedValueOnce(undefined as any);

		await insertPluginExecution({
			pluginName: "my-plugin",
			hook: "task:completed",
			projectId: "proj-1",
			durationMs: 42,
			success: true,
			error: null,
		});

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO plugin_executions"),
			expect.arrayContaining(["my-plugin", "task:completed", "proj-1", 42, true, null]),
		);
	});

	it("handles null projectId and error fields", async () => {
		mockExecute.mockResolvedValueOnce(undefined as any);

		await insertPluginExecution({
			pluginName: "bad-plugin",
			hook: "task:failed",
			projectId: null,
			durationMs: 100,
			success: false,
			error: "plugin crash",
		});

		expect(mockExecute).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO plugin_executions"),
			expect.arrayContaining(["bad-plugin", "task:failed", null, 100, false, "plugin crash"]),
		);
	});
});

describe("getPluginExecutions", () => {
	it("calls query with plugin name and limit", async () => {
		mockQuery.mockResolvedValueOnce([sampleExecutionRow]);

		const result = await getPluginExecutions("my-plugin", 25);

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining("WHERE plugin_name = $1"),
			["my-plugin", 25],
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			pluginName: "my-plugin",
			hook: "task:completed",
			projectId: "proj-1",
			durationMs: 42,
			success: true,
			error: null,
		});
	});

	it("uses default limit of 50 when not specified", async () => {
		mockQuery.mockResolvedValueOnce([]);

		await getPluginExecutions("my-plugin");

		expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["my-plugin", 50]);
	});
});
