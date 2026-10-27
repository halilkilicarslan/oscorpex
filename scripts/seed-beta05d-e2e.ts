#!/usr/bin/env npx tsx
// Beta-0.5D: Seed data for real workflow Playwright E2E testing
// Run: npx tsx scripts/seed-beta05d-e2e.ts
// Requires: Kernel running on :3141 with OSCORPEX_DEV_NO_AUTH=true

import http from "node:http";

const API = "http://localhost:3141/api/studio";

function post(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request(
			`${API}${path}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
			},
			(res) => {
				let buf = "";
				res.on("data", (c) => (buf += c));
				res.on("end", () => {
					try {
						resolve({ status: res.statusCode ?? 0, data: JSON.parse(buf) });
					} catch {
						resolve({ status: res.statusCode ?? 0, data: buf });
					}
				});
			},
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

function get(path: string): Promise<{ status: number; data: unknown }> {
	return new Promise((resolve, reject) => {
		http
			.get(`${API}${path}`, (res) => {
				let buf = "";
				res.on("data", (c) => (buf += c));
				res.on("end", () => {
					try {
						resolve({ status: res.statusCode ?? 0, data: JSON.parse(buf) });
					} catch {
						resolve({ status: res.statusCode ?? 0, data: buf });
					}
				});
			})
			.on("error", reject);
	});
}

async function seed() {
	console.log("=== Beta-0.5D Seed Script ===");
	console.log("Target:", API);

	// Check kernel health
	const health = await get("/../../health").catch(() => null);
	if (!health) {
		console.error("Kernel not reachable");
		process.exit(1);
	}

	// Check existing projects — uses synthetic data only, never real credentials
	const existing = await get("/projects?limit=5");
	const projects = Array.isArray(existing.data) ? existing.data : [];
	console.log(`Existing projects: ${projects.length}`);

	// Create test project if none exists — idempotent: skips if projects already present
	if (projects.length === 0) {
		console.log("Creating seed project...");
		const result = await post("/projects", {
			name: "alpha-demo-codebase",
			description: "E2E test project — AI-powered todo app with React frontend and Express backend",
			techStack: ["typescript", "react", "express", "postgresql"],
		});
		console.log("Project created:", result.status, (result.data as Record<string, unknown>)?.id ?? "unknown");
	} else {
		console.log("Projects already exist, skipping creation");
	}

	// Verify MCP tools
	const mcpTools = await get("/mcp/tools");
	console.log(
		"MCP tools:",
		mcpTools.status,
		Array.isArray((mcpTools.data as Record<string, unknown>)?.tools)
			? `${(mcpTools.data as Record<string, unknown[]>).tools.length} tools`
			: "unavailable",
	);

	// Verify Hermes tools
	const hermesTools = await get("/hermes/tools");
	console.log("Hermes tools:", hermesTools.status);

	// Verify scheduler
	const scheduler = await get("/scheduler/jobs");
	console.log("Scheduler:", scheduler.status);

	// Verify approvals
	const approvals = await get("/mcp/approvals");
	console.log("Approvals:", approvals.status);

	// Verify audit
	const audit = await get("/mcp/audit");
	console.log("Audit:", audit.status);

	// Verify agents
	const agents = await get("/agents");
	const agentList = Array.isArray(agents.data) ? agents.data : [];
	console.log(`Agents: ${agentList.length} preset agents loaded`);

	console.log("\n=== Seed Complete ===");
	console.log("Ready for Playwright E2E testing");
}

seed().catch((e: Error) => {
	console.error("Seed failed:", e.message);
	process.exit(1);
});
