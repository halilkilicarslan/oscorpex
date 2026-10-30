// ---------------------------------------------------------------------------
// F3-b r1 item 9 — gateway with auth disabled (dev bypass): an `x-tenant-id` header must not select the
// tenant; the local tenant is used. The gateway service is mocked: nothing real is invoked.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleGatewayRequest = vi.hoisted(() => vi.fn(async () => ({ ok: true, result: {} })));
vi.mock("../gateway/index.js", async (orig) => ({
	...(await orig<typeof import("../gateway/index.js")>()),
	handleGatewayRequest,
}));

import { LOCAL_TENANT_ID } from "../auth/auth-middleware.js";
import { studioRoutes } from "../index.js";
import { runOutsideScope } from "../tenancy/tenant-scope.js";
import { TENANT_B } from "./helpers/tenancy.js";

const ENV_KEYS = ["OSCORPEX_AUTH_ENABLED", "OSCORPEX_DEV_NO_AUTH", "OSCORPEX_API_KEY", "NODE_ENV"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
	process.env.OSCORPEX_DEV_NO_AUTH = "true";
	process.env.NODE_ENV = "test";
	handleGatewayRequest.mockClear();
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
});

function invoke(headers: Record<string, string>) {
	return runOutsideScope(async () =>
		studioRoutes.request("/gateway/invoke", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify({ toolName: "list_projects", args: {} }),
		}),
	);
}

describe("F3-b r1 — item 9: gateway tenant selection with auth disabled", () => {
	it("an x-tenant-id header does not select the tenant: the local tenant is used", async () => {
		await invoke({ "x-tenant-id": TENANT_B });
		expect(handleGatewayRequest).toHaveBeenCalledTimes(1);
		const arg = handleGatewayRequest.mock.calls[0] as unknown as [{ tenantId: string }];
		expect(arg[0].tenantId).toBe(LOCAL_TENANT_ID);
	});

	it("without the header the local tenant is used as well", async () => {
		await invoke({});
		expect(handleGatewayRequest).toHaveBeenCalledTimes(1);
		const arg = handleGatewayRequest.mock.calls[0] as unknown as [{ tenantId: string }];
		expect(arg[0].tenantId).toBe(LOCAL_TENANT_ID);
	});
});
