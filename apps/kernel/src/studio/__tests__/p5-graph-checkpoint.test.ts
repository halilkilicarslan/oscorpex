import { describe, expect, it } from "vitest";

describe("P5-C: Graph coordinator checkpoint", () => {
	it("graph-coordinator.ts imports createCheckpoint", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/graph-coordinator.ts"), "utf8");
		expect(src).toContain("createCheckpoint");
		expect(src).toContain("graph_mutation");
	});

	it("checkpoint is called before insertNode mutation", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/graph-coordinator.ts"), "utf8");
		expect(src).toContain("graph_mutation_pre_insert_node");
		const cpIdx = src.indexOf("createCheckpoint");
		const insertIdx = src.indexOf("applyInsertNode");
		expect(cpIdx).toBeGreaterThan(-1);
		expect(insertIdx).toBeGreaterThan(cpIdx);
	});

	it("checkpoint is called before splitTask mutation", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/graph-coordinator.ts"), "utf8");
		expect(src).toContain("graph_mutation_pre_split_task");
	});

	it("checkpoint is called before addEdge mutation", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/graph-coordinator.ts"), "utf8");
		expect(src).toContain("graph_mutation_pre_add_edge");
	});

	it("checkpoint failures are non-blocking (warn + continue)", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const src = readFileSync(join(process.cwd(), "src/studio/graph-coordinator.ts"), "utf8");
		// Errors must be caught and logged, not re-thrown
		expect(src).toContain("checkpoint creation failed (non-blocking)");
		expect(src).toContain("log.warn({ err }");
	});
});
