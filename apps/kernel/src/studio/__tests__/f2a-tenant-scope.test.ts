// ---------------------------------------------------------------------------
// F2a — tenant-scope AsyncLocalStorage unit tests
// ---------------------------------------------------------------------------

import { afterEach, describe, expect } from "vitest";
import {
	TenantScopeError,
	UnscopedQueryError,
	currentScope,
	runAsSystem,
	runInTenant,
	tenantScopeMode,
} from "../tenancy/tenant-scope.js";
import { it } from "./helpers/outside-scope.js";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("tenant-scope", () => {
	it("has no scope by default", () => {
		expect(currentScope()).toBeUndefined();
	});

	it("exposes error classes", () => {
		expect(new TenantScopeError("x")).toBeInstanceOf(Error);
		expect(new UnscopedQueryError("x")).toBeInstanceOf(Error);
	});

	describe("runInTenant", () => {
		it("sets tenant scope and returns the value", async () => {
			const out = await runInTenant(A, async () => {
				expect(currentScope()).toEqual({ kind: "tenant", tenantId: A });
				return 42;
			});
			expect(out).toBe(42);
		});

		it("keeps scope across awaits", async () => {
			await runInTenant(A, async () => {
				await sleep(5);
				await Promise.resolve();
				expect(currentScope()).toEqual({ kind: "tenant", tenantId: A });
			});
		});

		it.each([
			["empty", ""],
			["too long", "x".repeat(129)],
			["newline", "a\nb"],
			["NUL", "a\u0000b"],
			["tab", "a\tb"],
			["DEL", "a\u007fb"],
			["non-string", 123 as unknown as string],
			["undefined", undefined as unknown as string],
		])("rejects invalid tenantId (%s)", async (_n, id) => {
			await expect(runInTenant(id, async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
		});

		it("accepts 128-char id", async () => {
			await expect(runInTenant("x".repeat(128), async () => 1)).resolves.toBe(1);
		});

		it("allows same tenant nested", async () => {
			await runInTenant(A, () =>
				runInTenant(A, async () => {
					expect(currentScope()).toEqual({ kind: "tenant", tenantId: A });
				}),
			);
		});

		it("rejects a different tenant nested", async () => {
			await runInTenant(A, async () => {
				await expect(runInTenant(B, async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
				expect(currentScope()).toEqual({ kind: "tenant", tenantId: A });
			});
		});

		it("does not leak scope after resolve", async () => {
			await runInTenant(A, async () => 1);
			expect(currentScope()).toBeUndefined();
		});

		it("does not leak scope after rejection", async () => {
			await expect(
				runInTenant(A, async () => {
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(currentScope()).toBeUndefined();
		});

		it("isolates concurrent scopes", async () => {
			const seen = await Promise.all(
				Array.from({ length: 30 }, (_, i) => {
					const id = i % 2 === 0 ? A : B;
					return runInTenant(id, async () => {
						await sleep(Math.random() * 10);
						const s = currentScope();
						await sleep(Math.random() * 10);
						return [id, s, currentScope()] as const;
					});
				}),
			);
			for (const [id, s1, s2] of seen) {
				expect(s1).toEqual({ kind: "tenant", tenantId: id });
				expect(s2).toEqual({ kind: "tenant", tenantId: id });
			}
		});
	});

	describe("runAsSystem", () => {
		it("sets system scope with reason", async () => {
			await runAsSystem("boot", async () => {
				expect(currentScope()).toEqual({ kind: "system", reason: "boot" });
			});
			expect(currentScope()).toBeUndefined();
		});

		it("allows runInTenant inside system (system → tenant)", async () => {
			await runAsSystem("sweep", () =>
				runInTenant(A, async () => {
					expect(currentScope()).toEqual({ kind: "tenant", tenantId: A });
				}),
			);
		});

		it("restores system scope after inner tenant scope ends", async () => {
			await runAsSystem("sweep", async () => {
				await runInTenant(A, async () => 1);
				expect(currentScope()).toEqual({ kind: "system", reason: "sweep" });
			});
		});

		it("rejects runAsSystem inside a tenant scope", async () => {
			await runInTenant(A, async () => {
				await expect(runAsSystem("escalate", async () => 1)).rejects.toBeInstanceOf(TenantScopeError);
				expect(currentScope()).toEqual({ kind: "tenant", tenantId: A });
			});
		});

		it("does not leak after rejection", async () => {
			await expect(
				runAsSystem("x", async () => {
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(currentScope()).toBeUndefined();
		});
	});

	describe("tenantScopeMode", () => {
		const orig = process.env.OSCORPEX_TENANT_SCOPE_MODE;
		afterEach(() => {
			if (orig === undefined) Reflect.deleteProperty(process.env, "OSCORPEX_TENANT_SCOPE_MODE");
			else process.env.OSCORPEX_TENANT_SCOPE_MODE = orig;
		});

		it("defaults to warn", () => {
			Reflect.deleteProperty(process.env, "OSCORPEX_TENANT_SCOPE_MODE");
			expect(tenantScopeMode()).toBe("warn");
		});

		it("reads strict", () => {
			process.env.OSCORPEX_TENANT_SCOPE_MODE = "strict";
			expect(tenantScopeMode()).toBe("strict");
		});

		it("falls back to warn on unknown value", () => {
			process.env.OSCORPEX_TENANT_SCOPE_MODE = "bogus";
			expect(tenantScopeMode()).toBe("warn");
		});
	});
});
