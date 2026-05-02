import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverApi, loadCollection, saveCollection } from "../api-discovery.js";

describe("api-discovery", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "api-discovery-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------------
	// OpenAPI spec detection
	// ---------------------------------------------------------------------------
	describe("discoverApi — OpenAPI spec", () => {
		it("should parse swagger.json and return routes", async () => {
			writeFileSync(
				join(tmpDir, "swagger.json"),
				JSON.stringify({
					basePath: "/api/v1",
					paths: {
						"/users": {
							get: { summary: "List users" },
							post: { summary: "Create user" },
						},
						"/users/{id}": {
							get: { summary: "Get user by ID" },
							delete: { summary: "Delete user" },
						},
					},
				}),
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("openapi");
			expect(result.basePath).toBe("/api/v1");
			expect(result.routes).toHaveLength(4);
			expect(result.routes[0]).toMatchObject({ method: "GET", path: "/users", description: "List users" });
			expect(result.routes[1]).toMatchObject({ method: "POST", path: "/users" });
			expect(result.routes[2]).toMatchObject({ method: "GET", path: "/users/{id}", params: ["id"] });
			expect(result.routes[3]).toMatchObject({ method: "DELETE", path: "/users/{id}" });
		});

		it("should parse openapi.json with servers array", async () => {
			writeFileSync(
				join(tmpDir, "openapi.json"),
				JSON.stringify({
					openapi: "3.0.0",
					servers: [{ url: "https://api.example.com/v2" }],
					paths: {
						"/items": { get: { summary: "List items" } },
					},
				}),
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("openapi");
			expect(result.basePath).toBe("https://api.example.com/v2");
			expect(result.routes).toHaveLength(1);
		});

		it("should skip invalid JSON", async () => {
			writeFileSync(join(tmpDir, "swagger.json"), "{ broken json");
			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).not.toBe("openapi");
		});
	});

	// ---------------------------------------------------------------------------
	// Source code route parsing
	// ---------------------------------------------------------------------------
	describe("discoverApi — source parse", () => {
		it("should detect Express routes", async () => {
			mkdirSync(join(tmpDir, "routes"), { recursive: true });
			writeFileSync(
				join(tmpDir, "routes", "items.js"),
				`
const express = require('express');
const router = express.Router();

// List all items
router.get('/', (req, res) => { res.json([]); });

// Create item
router.post('/', (req, res) => { res.status(201).json(req.body); });

// Get single item
router.get('/:id', (req, res) => { res.json({}); });

router.put('/:id', (req, res) => { res.json({}); });
router.delete('/:id', (req, res) => { res.sendStatus(204); });

module.exports = router;
`,
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("source-parse");
			expect(result.routes.length).toBeGreaterThanOrEqual(5);

			const methods = result.routes.map((r) => r.method);
			expect(methods).toContain("GET");
			expect(methods).toContain("POST");
			expect(methods).toContain("PUT");
			expect(methods).toContain("DELETE");
		});

		it("should detect Fastify routes", async () => {
			mkdirSync(join(tmpDir, "routes"), { recursive: true });
			writeFileSync(
				join(tmpDir, "routes", "users.ts"),
				`
fastify.get('/users', async (req, reply) => { return []; });
fastify.post('/users', async (req, reply) => { return req.body; });
`,
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("source-parse");
			expect(result.routes).toHaveLength(2);
			expect(result.routes[0]).toMatchObject({ method: "GET", path: "/users" });
			expect(result.routes[1]).toMatchObject({ method: "POST", path: "/users" });
		});

		it("should detect NestJS decorator routes", async () => {
			mkdirSync(join(tmpDir, "controllers"), { recursive: true });
			writeFileSync(
				join(tmpDir, "controllers", "cats.ts"),
				`
@Get('/cats')
findAll() { return this.catsService.findAll(); }

@Post('/cats')
create(@Body() dto: CreateCatDto) { return this.catsService.create(dto); }

@Delete('/cats/:id')
remove(@Param('id') id: string) { return this.catsService.remove(id); }
`,
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("source-parse");
			expect(result.routes).toHaveLength(3);
			expect(result.routes[0]).toMatchObject({ method: "GET", path: "/cats" });
			expect(result.routes[2]).toMatchObject({ method: "DELETE", path: "/cats/:id", params: ["id"] });
		});

		it("should resolve mount prefixes", async () => {
			mkdirSync(join(tmpDir, "src"), { recursive: true });
			mkdirSync(join(tmpDir, "routes"), { recursive: true });

			writeFileSync(
				join(tmpDir, "src", "app.ts"),
				`
const itemsRouter = require('./routes/items');
app.use('/api/v1', itemsRouter);
`,
			);

			writeFileSync(
				join(tmpDir, "routes", "items.js"),
				`
router.get('/', (req, res) => res.json([]));
router.post('/', (req, res) => res.json(req.body));
`,
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("source-parse");
			expect(result.routes.length).toBeGreaterThanOrEqual(2);
		});

		it("should detect path params", async () => {
			mkdirSync(join(tmpDir, "routes"), { recursive: true });
			writeFileSync(
				join(tmpDir, "routes", "orders.js"),
				`
router.get('/orders/:orderId/items/:itemId', (req, res) => {});
`,
			);

			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("source-parse");
			const route = result.routes.find((r) => r.path.includes("orderId"));
			expect(route).toBeDefined();
			expect(route!.params).toEqual(["orderId", "itemId"]);
		});

		it("should return none when no routes found", async () => {
			const result = await discoverApi(tmpDir);
			expect(result.discoveryMethod).toBe("none");
			expect(result.routes).toHaveLength(0);
		});

		it("should deduplicate routes", async () => {
			mkdirSync(join(tmpDir, "routes"), { recursive: true });
			writeFileSync(
				join(tmpDir, "routes", "dup.js"),
				`
router.get('/health', handler);
router.get('/health', handler2);
`,
			);

			const result = await discoverApi(tmpDir);
			const healthRoutes = result.routes.filter((r) => r.path.includes("health") && r.method === "GET");
			expect(healthRoutes).toHaveLength(1);
		});
	});

	// ---------------------------------------------------------------------------
	// Collection persistence
	// ---------------------------------------------------------------------------
	describe("collection persistence", () => {
		it("should return empty collection for unknown project", async () => {
			const coll = await loadCollection("nonexistent-project");
			expect(coll.projectId).toBe("nonexistent-project");
			expect(coll.requests).toHaveLength(0);
		});

		it("should save and load collection", async () => {
			const collection = {
				projectId: "test-save-load",
				requests: [
					{
						id: "req-1",
						method: "GET" as const,
						path: "/api/users",
						lastStatus: 200,
						lastDuration: 45,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
				],
			};

			await saveCollection(collection);
			const loaded = await loadCollection("test-save-load");
			expect(loaded.requests).toHaveLength(1);
			expect(loaded.requests[0].method).toBe("GET");
			expect(loaded.requests[0].path).toBe("/api/users");
			expect(loaded.requests[0].lastStatus).toBe(200);
		});
	});
});
