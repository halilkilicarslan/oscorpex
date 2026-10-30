// ---------------------------------------------------------------------------
// F3-0 — Preview proxy hardening (request header strip, response header policy)
// ---------------------------------------------------------------------------

import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let upstreamPort = 0;

vi.mock("../app-runner.js", () => ({
	getAppStatus: vi.fn(() => ({
		running: true,
		previewUrl: `http://127.0.0.1:${upstreamPort}`,
		services: [],
	})),
	getResolvedConfig: vi.fn(),
	startApp: vi.fn(),
	stopApp: vi.fn(),
	switchPreviewService: vi.fn(),
}));
vi.mock("../container-pool.js", () => ({ containerPool: { getStatus: vi.fn() } }));
vi.mock("../db-provisioner.js", () => ({
	getDbStatus: vi.fn(),
	parseCloudUrl: vi.fn(),
	provisionDatabase: vi.fn(),
	stopAllDatabases: vi.fn(),
	stopDatabase: vi.fn(),
}));
vi.mock("../db.js", () => ({ getProject: vi.fn() }));
vi.mock("../runtime-analyzer.js", () => ({ analyzeProject: vi.fn(), writeEnvFile: vi.fn() }));
vi.mock("../routes/team-init-guard.js", () => ({ ensureProjectTeamInitialized: vi.fn() }));

import { getAppStatus } from "../app-runner.js";
import { runtimeRoutes } from "../routes/runtime-routes.js";

const EXACT_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals";
const PNG_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0x81, 0xc3, 0x28,
]);
const HTML_DOC = `<html><head><title>x</title></head><body>${"hello ".repeat(200)}END-OF-BODY</body></html>`;

let server: Server | undefined;
let lastHeaders: IncomingHttpHeaders = {};
let hits: string[] = [];
const app = new Hono();
app.route("/", runtimeRoutes);

beforeAll(async () => {
	server = createServer((req, res) => {
		lastHeaders = req.headers;
		const url = req.url ?? "/";
		hits.push(url);
		if (url.startsWith("/redir")) {
			res.writeHead(302, { location: "/redirected-target" });
			res.end();
			return;
		}
		if (url.startsWith("/redirected-target")) {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("target");
			return;
		}
		if (url.startsWith("/hdrs")) {
			res.writeHead(200, {
				"content-type": "text/plain",
				"cache-control": "max-age=60",
				etag: '"abc"',
				"last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
				expires: "Thu, 22 Oct 2099 07:28:00 GMT",
				vary: "accept",
				"content-language": "en",
				"content-disposition": 'inline; filename="a.txt"',
				location: "/somewhere",
				"accept-ranges": "bytes",
				"content-range": "bytes 0-3/4",
				"clear-site-data": '"cache", "cookies"',
				nel: '{"report_to":"x","max_age":1}',
				"report-to": '{"group":"x","max_age":1,"endpoints":[]}',
				"reporting-endpoints": 'x="https://evil.example/r"',
				"set-cookie": "sid=1",
				refresh: "0; url=https://evil.example/",
				link: "<https://evil.example/>; rel=preload",
				"server-timing": "db;dur=1",
				"x-powered-by": "evil",
			});
			res.end("body");
			return;
		}
		if (url.startsWith("/gz-page")) {
			const gz = gzipSync(Buffer.from(HTML_DOC));
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"content-encoding": "gzip",
				"content-length": String(gz.length),
			});
			res.end(gz);
			return;
		}
		if (url.startsWith("/png")) {
			res.writeHead(200, { "content-type": "image/png" });
			res.end(PNG_BYTES);
			return;
		}
		if (url.startsWith("/created")) {
			res.writeHead(201, { "content-type": "application/json" });
			res.end('{"ok":true}');
			return;
		}
		if (url.startsWith("/teapot")) {
			res.writeHead(418, { "content-type": "text/plain" });
			res.end("short and stout");
			return;
		}
		if (url === "/") {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("nope");
			return;
		}
		if (url.startsWith("/page")) {
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"set-cookie": "sid=upstream-secret; Path=/",
			});
			res.end("<html><head><title>x</title></head><body>hi</body></html>");
			return;
		}
		if (url.startsWith("/app.js")) {
			res.writeHead(200, { "content-type": "application/javascript", "set-cookie": "a=1" });
			res.end("console.log(1)");
			return;
		}
		if (url.startsWith("/img.svg")) {
			res.writeHead(200, { "content-type": "image/svg+xml", "set-cookie": "b=2" });
			res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end("{}");
	});
	await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
	upstreamPort = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

beforeEach(() => {
	lastHeaders = {};
	hits = [];
});

const BASE = "http://localhost/projects/p1/app/proxy";

describe("F3-0 preview proxy — request headers", () => {
	it("does not forward credential headers upstream", async () => {
		const res = await app.request(`${BASE}/api/data`, {
			headers: {
				authorization: "Bearer console-jwt",
				cookie: "oscorpex_session=abc",
				"x-api-key": "osk_secret",
				"proxy-authorization": "Basic Zm9vOmJhcg==",
			},
		});
		expect(res.status).toBe(200);
		expect(lastHeaders.authorization).toBeUndefined();
		expect(lastHeaders.cookie).toBeUndefined();
		expect(lastHeaders["x-api-key"]).toBeUndefined();
		expect(lastHeaders["proxy-authorization"]).toBeUndefined();
	});

	it("forwards conditional request headers if-match, if-unmodified-since, if-range", async () => {
		await app.request(`${BASE}/api/data`, {
			headers: {
				"if-match": '"abc"',
				"if-unmodified-since": "Wed, 21 Oct 2015 07:28:00 GMT",
				"if-range": '"abc"',
				range: "bytes=0-1",
			},
		});
		expect(lastHeaders["if-match"]).toBe('"abc"');
		expect(lastHeaders["if-unmodified-since"]).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
		expect(lastHeaders["if-range"]).toBe('"abc"');
	});

	it("forwards range, if-none-match and if-modified-since upstream", async () => {
		await app.request(`${BASE}/api/data`, {
			headers: {
				range: "bytes=0-1",
				"if-none-match": '"abc"',
				"if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT",
			},
		});
		expect(lastHeaders.range).toBe("bytes=0-1");
		expect(lastHeaders["if-none-match"]).toBe('"abc"');
		expect(lastHeaders["if-modified-since"]).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
	});

	it("does not forward the caller's accept-encoding", async () => {
		await app.request(`${BASE}/api/data`, { headers: { "accept-encoding": "x-caller-enc" } });
		expect(String(lastHeaders["accept-encoding"] ?? "")).not.toContain("x-caller-enc");
	});

	it("API Explorer: x-oscorpex-upstream-authorization arrives upstream as authorization; caller's own is dropped", async () => {
		await app.request(`${BASE}/api/data`, {
			headers: {
				authorization: "Bearer console-jwt",
				"x-oscorpex-upstream-authorization": "Bearer app-token",
			},
		});
		expect(lastHeaders.authorization).toBe("Bearer app-token");
		expect(lastHeaders["x-oscorpex-upstream-authorization"]).toBeUndefined();
	});

	it("caller authorization alone is never forwarded", async () => {
		await app.request(`${BASE}/api/data`, { headers: { authorization: "Bearer console-jwt" } });
		expect(lastHeaders.authorization).toBeUndefined();
	});

	it("still forwards normal headers", async () => {
		await app.request(`${BASE}/api/data`, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json", "user-agent": "f3-test/1.0" },
			body: "{}",
		});
		expect(lastHeaders.accept).toBe("application/json");
		expect(lastHeaders["content-type"]).toBe("application/json");
		expect(lastHeaders["user-agent"]).toBe("f3-test/1.0");
	});
});

describe("F3-0 preview proxy — response headers", () => {
	it("does not pass upstream Set-Cookie to the client", async () => {
		for (const p of ["/page", "/app.js", "/img.svg"]) {
			const res = await app.request(`${BASE}${p}`);
			expect(res.headers.get("set-cookie"), p).toBeNull();
		}
	});

	for (const [path, type] of [
		["/page", "HTML"],
		["/app.js", "JS"],
		["/img.svg", "SVG"],
	] as const) {
		it(`${type} response carries a sandboxing CSP and nosniff`, async () => {
			const res = await app.request(`${BASE}${path}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-security-policy")).toBe(EXACT_CSP);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		});
	}
});

describe("F3-0 preview proxy — response header allowlist", () => {
	it("passes allowlisted headers and drops everything else", async () => {
		const res = await app.request(`${BASE}/hdrs`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/plain");
		expect(res.headers.get("cache-control")).toBe("max-age=60");
		expect(res.headers.get("etag")).toBe('"abc"');
		expect(res.headers.get("last-modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
		expect(res.headers.get("expires")).toBe("Thu, 22 Oct 2099 07:28:00 GMT");
		expect(res.headers.get("vary")).toBe("accept");
		expect(res.headers.get("content-language")).toBe("en");
		expect(res.headers.get("content-disposition")).toBe('inline; filename="a.txt"');
		expect(res.headers.get("location")).toBe("/somewhere");
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect(res.headers.get("content-range")).toBe("bytes 0-3/4");
		expect(res.headers.get("date")).toBeTruthy();
		for (const h of [
			"clear-site-data",
			"nel",
			"report-to",
			"reporting-endpoints",
			"set-cookie",
			"refresh",
			"link",
			"server-timing",
			"x-powered-by",
		]) {
			expect(res.headers.get(h), `${h} must be dropped`).toBeNull();
		}
		expect(res.headers.get("content-security-policy")).toBe(EXACT_CSP);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("F3-0 preview proxy — redirects, bodies and status passthrough", () => {
	it("does not follow upstream redirects: 302 reaches the client without a Location header, target is not fetched", async () => {
		const res = await app.request(`${BASE}/redir`);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBeNull();
		expect(res.headers.get("x-oscorpex-upstream-location")).toBe("/redirected-target");
		expect(hits).not.toContain("/redirected-target");
	});

	it("HTML rewrite: no stale content-length/content-encoding and the full body arrives", async () => {
		const res = await app.request(`${BASE}/gz-page`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-encoding")).toBeNull();
		const body = await res.text();
		expect(body).toContain("END-OF-BODY");
		expect(body).toContain("</html>");
		expect(body).toContain("<base href=");
		const cl = res.headers.get("content-length");
		if (cl !== null) expect(Number(cl)).toBe(Buffer.byteLength(body));
	});

	it("binary body passes through byte-identical", async () => {
		const res = await app.request(`${BASE}/png`);
		expect(res.status).toBe(200);
		expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
	});

	it("non-200 statuses pass through (201, 418)", async () => {
		const created = await app.request(`${BASE}/created`);
		expect(created.status).toBe(201);
		expect(await created.text()).toBe('{"ok":true}');
		const teapot = await app.request(`${BASE}/teapot`);
		expect(teapot.status).toBe(418);
		expect(await teapot.text()).toBe("short and stout");
	});
});

describe("F3-0 preview proxy — error and fallback pages carry the sandbox CSP", () => {
	it("API-only 404 page", async () => {
		const res = await app.request(`${BASE}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-security-policy")).toBe(EXACT_CSP);
	});

	it("502 'App is not running'", async () => {
		vi.mocked(getAppStatus).mockReturnValueOnce({ running: false, previewUrl: null, services: [] } as never);
		const res = await app.request(`${BASE}/page`);
		expect(res.status).toBe(502);
		expect(res.headers.get("content-security-policy")).toBe(EXACT_CSP);
	});

	it("502 proxy error (upstream unreachable)", async () => {
		vi.mocked(getAppStatus).mockReturnValueOnce({
			running: true,
			previewUrl: "http://127.0.0.1:1",
			services: [],
		} as never);
		const res = await app.request(`${BASE}/page`);
		expect(res.status).toBe(502);
		expect(await res.text()).toContain("Proxy error");
		expect(res.headers.get("content-security-policy")).toBe(EXACT_CSP);
	});
});

describe("F3-0 preview proxy — regression controls", () => {
	it("injects a <base href> tag into proxied HTML", async () => {
		const res = await app.request(`${BASE}/page`);
		const html = await res.text();
		expect(html).toContain(`<base href="http://127.0.0.1:${upstreamPort}/">`);
	});

	it("serves the API-only page with 200 when upstream 404s on '/'", async () => {
		const res = await app.request(`${BASE}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("API-Only Application");
	});
});
