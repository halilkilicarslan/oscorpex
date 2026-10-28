import { describe, expect, it } from "vitest";
import { UpdateProjectSchema, CreateAgentSchema, parseBody } from "../routes/validation-schemas.js";

describe("P1-6: Zod validation schemas", () => {
	it("rejects unknown fields in project update (strict mode)", () => {
		const result = parseBody(UpdateProjectSchema, { name: "ok", repoPath: "/etc", tenant_id: "evil" });
		expect(result.success).toBe(false);
	});

	it("accepts valid project update", () => {
		const result = parseBody(UpdateProjectSchema, { name: "My Project", description: "desc" });
		expect(result.success).toBe(true);
	});

	it("accepts isPreset in agent creation (authorization is enforced by the route: platform admin only)", () => {
		const result = parseBody(CreateAgentSchema, { name: "test", role: "dev", isPreset: true });
		expect(result.success).toBe(true);
	});

	it("still rejects other unknown fields in agent creation (strict mode)", () => {
		const result = parseBody(CreateAgentSchema, { name: "test", role: "dev", tenant_id: "evil" });
		expect(result.success).toBe(false);
	});

	it("accepts valid agent creation", () => {
		const result = parseBody(CreateAgentSchema, { name: "test-agent", role: "developer" });
		expect(result.success).toBe(true);
	});

	it("rejects oversized name", () => {
		const result = parseBody(UpdateProjectSchema, { name: "x".repeat(200) });
		expect(result.success).toBe(false);
	});
});
