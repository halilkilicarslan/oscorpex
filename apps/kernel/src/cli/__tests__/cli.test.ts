// ---------------------------------------------------------------------------
// CLI Tests — API client, command arg parsing, output formatting
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers: fetch mock factory
// ---------------------------------------------------------------------------

function makeFetchMock(status: number, body: unknown, contentType = "application/json") {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Internal Server Error",
		headers: {
			get: (key: string) => (key.toLowerCase() === "content-type" ? contentType : null),
		},
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(String(body)),
	});
}

// ---------------------------------------------------------------------------
// 1. API Client — URL construction
// ---------------------------------------------------------------------------
describe("apiGet — URL construction", () => {
	it("appends /api/studio prefix to the path", async () => {
		const fetchMock = makeFetchMock(200, { ok: true });
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		await apiGet("/projects", { apiUrl: "http://localhost:3141" });

		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:3141/api/studio/projects",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("supports custom api-url", async () => {
		const fetchMock = makeFetchMock(200, []);
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		await apiGet("/projects", { apiUrl: "https://example.com" });

		expect(fetchMock).toHaveBeenCalledWith("https://example.com/api/studio/projects", expect.anything());
	});
});

// ---------------------------------------------------------------------------
// 2. API Client — Auth header
// ---------------------------------------------------------------------------
describe("apiGet — auth header", () => {
	it("includes Authorization header when apiKey is provided", async () => {
		const fetchMock = makeFetchMock(200, {});
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		await apiGet("/projects/abc", { apiUrl: "http://localhost:3141", apiKey: "osx_secret" });

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer osx_secret");
	});

	it("omits Authorization header when no apiKey", async () => {
		const fetchMock = makeFetchMock(200, {});
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		await apiGet("/projects/abc", { apiUrl: "http://localhost:3141" });

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 3. API Client — POST body
// ---------------------------------------------------------------------------
describe("apiPost — body serialization", () => {
	it("serializes body as JSON and uses POST method", async () => {
		const fetchMock = makeFetchMock(200, { id: "proj-1" });
		vi.stubGlobal("fetch", fetchMock);

		const { apiPost } = await import("../api-client.js");
		await apiPost("/projects", { name: "My App", description: "desc" }, { apiUrl: "http://localhost:3141" });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:3141/api/studio/projects");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({ name: "My App", description: "desc" });
	});
});

// ---------------------------------------------------------------------------
// 4. API Client — Error handling (404)
// ---------------------------------------------------------------------------
describe("apiGet — error handling", () => {
	it("throws ApiError with status 404 and message from body", async () => {
		const fetchMock = makeFetchMock(404, { error: "Project not found" });
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");

		await expect(apiGet("/projects/missing", { apiUrl: "http://localhost:3141" })).rejects.toMatchObject({
			status: 404,
			message: "Project not found",
		});
	});

	it("throws ApiError with status 500 on server error", async () => {
		const fetchMock = makeFetchMock(500, { message: "Internal error" });
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");

		await expect(apiGet("/projects", { apiUrl: "http://localhost:3141" })).rejects.toMatchObject({
			status: 500,
		});
	});

	it("throws connection error when fetch rejects (API down)", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

		const { apiGet } = await import("../api-client.js");

		await expect(apiGet("/projects", { apiUrl: "http://localhost:3141" })).rejects.toMatchObject({
			status: 0,
			message: expect.stringContaining("Cannot connect"),
		});
	});
});

// ---------------------------------------------------------------------------
// 5. API Client — formatApiError
// ---------------------------------------------------------------------------
describe("formatApiError", () => {
	it("returns message from ApiError object", async () => {
		const { formatApiError } = await import("../api-client.js");
		expect(formatApiError({ status: 404, message: "not found" })).toBe("not found");
	});

	it("returns message from Error instance", async () => {
		const { formatApiError } = await import("../api-client.js");
		expect(formatApiError(new Error("boom"))).toBe("boom");
	});

	it("converts unknown values to string", async () => {
		const { formatApiError } = await import("../api-client.js");
		expect(formatApiError("raw string error")).toBe("raw string error");
	});
});

// ---------------------------------------------------------------------------
// 6. Colors helpers
// ---------------------------------------------------------------------------
describe("colors helpers", () => {
	it("wraps text in ANSI green codes", async () => {
		const { green } = await import("../colors.js");
		const result = green("hello");
		expect(result).toContain("\x1b[32m");
		expect(result).toContain("hello");
		expect(result).toContain("\x1b[0m");
	});

	it("colorStatus returns green for 'done'", async () => {
		const { colorStatus } = await import("../colors.js");
		expect(colorStatus("done")).toContain("\x1b[32m");
	});

	it("colorStatus returns red for 'failed'", async () => {
		const { colorStatus } = await import("../colors.js");
		expect(colorStatus("failed")).toContain("\x1b[31m");
	});

	it("colorStatus returns yellow for 'running'", async () => {
		const { colorStatus } = await import("../colors.js");
		expect(colorStatus("running")).toContain("\x1b[33m");
	});

	it("colorStatus returns gray for 'queued'", async () => {
		const { colorStatus } = await import("../colors.js");
		expect(colorStatus("queued")).toContain("\x1b[90m");
	});
});

// ---------------------------------------------------------------------------
// 7. Projects command — lists projects (integration-style)
// ---------------------------------------------------------------------------
describe("projects command — apiGet call", () => {
	it("calls GET /projects endpoint", async () => {
		const projects = [{ id: "abc-123", name: "My App", status: "active", createdAt: "2025-01-01T00:00:00Z" }];
		const fetchMock = makeFetchMock(200, projects);
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		const result = await apiGet<typeof projects>("/projects", { apiUrl: "http://localhost:3141" });

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("My App");
		expect(fetchMock).toHaveBeenCalledWith("http://localhost:3141/api/studio/projects", expect.anything());
	});
});

// ---------------------------------------------------------------------------
// 8. Status command — tasks response normalization
// ---------------------------------------------------------------------------
describe("status command — task response shapes", () => {
	it("handles array response for tasks", async () => {
		const tasks = [
			{ id: "t1", title: "Setup DB", status: "done", assignedAgent: "backend-dev", phase: 1 },
			{ id: "t2", title: "Build API", status: "running", assignedAgent: "backend-dev", phase: 2 },
		];
		const fetchMock = makeFetchMock(200, tasks);
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		const raw = await apiGet<typeof tasks>("/projects/proj-1/tasks", { apiUrl: "http://localhost:3141" });

		expect(Array.isArray(raw)).toBe(true);
		expect(raw).toHaveLength(2);
		expect(raw[0].status).toBe("done");
	});

	it("handles wrapped {tasks:[]} response", async () => {
		const wrapped = {
			tasks: [{ id: "t1", title: "Init", status: "queued", phase: 1 }],
		};
		const fetchMock = makeFetchMock(200, wrapped);
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		const raw = await apiGet<typeof wrapped>("/projects/proj-1/tasks", { apiUrl: "http://localhost:3141" });

		// Normalize as the status command does
		const tasks = Array.isArray(raw) ? raw : (raw.tasks ?? []);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].status).toBe("queued");
	});
});

// ---------------------------------------------------------------------------
// 9. Init command — POST /projects
// ---------------------------------------------------------------------------
describe("init command — project creation", () => {
	it("calls POST /projects with correct body", async () => {
		const created = { id: "new-proj-id", name: "My CLI App", status: "pending" };
		const fetchMock = makeFetchMock(200, created);
		vi.stubGlobal("fetch", fetchMock);

		const { apiPost } = await import("../api-client.js");
		const result = await apiPost<typeof created>(
			"/projects",
			{ name: "My CLI App", description: "Built via CLI" },
			{ apiUrl: "http://localhost:3141" },
		);

		expect(result.id).toBe("new-proj-id");
		expect(result.name).toBe("My CLI App");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body.name).toBe("My CLI App");
		expect(body.description).toBe("Built via CLI");
	});
});

// ---------------------------------------------------------------------------
// 10. Start command — POST /projects/:id/execute
// ---------------------------------------------------------------------------
describe("start command — execute endpoint", () => {
	it("calls POST /projects/:id/execute", async () => {
		const fetchMock = makeFetchMock(200, { started: true });
		vi.stubGlobal("fetch", fetchMock);

		const { apiPost } = await import("../api-client.js");
		await apiPost("/projects/proj-abc/execute", {}, { apiUrl: "http://localhost:3141" });

		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:3141/api/studio/projects/proj-abc/execute",
			expect.objectContaining({ method: "POST" }),
		);
	});
});

// ---------------------------------------------------------------------------
// 11. Deploy command — start and status
// ---------------------------------------------------------------------------
describe("deploy command — app start and status", () => {
	it("calls POST /projects/:id/app/start", async () => {
		const fetchMock = makeFetchMock(200, { url: "http://localhost:4242" });
		vi.stubGlobal("fetch", fetchMock);

		const { apiPost } = await import("../api-client.js");
		const result = await apiPost<{ url: string }>(
			"/projects/proj-xyz/app/start",
			{},
			{ apiUrl: "http://localhost:3141" },
		);

		expect(result.url).toBe("http://localhost:4242");
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:3141/api/studio/projects/proj-xyz/app/start",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("calls GET /projects/:id/app/status", async () => {
		const appStatus = { running: true, status: "running", url: "http://localhost:4242", port: 4242 };
		const fetchMock = makeFetchMock(200, appStatus);
		vi.stubGlobal("fetch", fetchMock);

		const { apiGet } = await import("../api-client.js");
		const result = await apiGet<typeof appStatus>("/projects/proj-xyz/app/status", { apiUrl: "http://localhost:3141" });

		expect(result.running).toBe(true);
		expect(result.port).toBe(4242);
	});
});

// ---------------------------------------------------------------------------
// 12. API Client — Content-Type header is set
// ---------------------------------------------------------------------------
describe("apiPost — Content-Type header", () => {
	it("sets Content-Type: application/json", async () => {
		const fetchMock = makeFetchMock(200, {});
		vi.stubGlobal("fetch", fetchMock);

		const { apiPost } = await import("../api-client.js");
		await apiPost("/projects", {}, { apiUrl: "http://localhost:3141" });

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});
});

// ---------------------------------------------------------------------------
// 13. Deploy command — connection error propagation
// ---------------------------------------------------------------------------
describe("deploy command — error handling", () => {
	it("throws connection error for app/start when API is unreachable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

		const { apiPost } = await import("../api-client.js");

		await expect(apiPost("/projects/proj/app/start", {}, { apiUrl: "http://localhost:9999" })).rejects.toMatchObject({
			status: 0,
			message: expect.stringContaining("Cannot connect"),
		});
	});
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});
