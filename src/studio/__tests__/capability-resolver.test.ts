import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesToToolList, resolveAllowedTools } from "../capability-resolver.js";
import type { AgentCapability } from "../types.js";

// DB modülünü mock'la — gerçek PostgreSQL bağlantısı gerektirmez
vi.mock("../db.js", () => ({
	listAgentCapabilities: vi.fn(),
}));

import { listAgentCapabilities } from "../db.js";

const mockListCapabilities = vi.mocked(listAgentCapabilities);

// Boş yetenek listesi — role fallback'i test etmek için
const NO_CAPS: AgentCapability[] = [];

// Tool tipinde yetenek oluşturan yardımcı
function makeCap(pattern: string): AgentCapability {
	return {
		id: "cap-1",
		agentId: "agent-1",
		projectId: "proj-1",
		scopeType: "tool",
		permission: "allow",
		pattern,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// capabilitiesToToolList
// ---------------------------------------------------------------------------

describe("capabilitiesToToolList", () => {
	it("DB yeteneği olmayınca role varsayılanını döner", () => {
		const result = capabilitiesToToolList(NO_CAPS, "frontend-dev");
		expect(result).toEqual(["Read", "Edit", "Write", "Bash", "Glob", "Grep"]);
	});

	it("scopeType=tool ve permission=allow olan kayıtları araç listesi olarak döner", () => {
		const caps: AgentCapability[] = [makeCap("Read"), makeCap("Glob")];
		const result = capabilitiesToToolList(caps, "frontend-dev");
		expect(result).toEqual(["Read", "Glob"]);
	});

	it("scopeType='path' olan kayıtları araç olarak saymaz", () => {
		const caps: AgentCapability[] = [
			{ id: "1", agentId: "a", projectId: "p", scopeType: "path", permission: "allow", pattern: "src/**" },
		];
		// path tipi kayıt araç sayılmaz → role fallback devreye girer
		const result = capabilitiesToToolList(caps, "reviewer");
		expect(result).toEqual(["Read", "Glob", "Grep"]);
	});

	it("permission='readwrite' olan kayıtları araç olarak saymaz", () => {
		const caps: AgentCapability[] = [
			{ id: "1", agentId: "a", projectId: "p", scopeType: "tool", permission: "readwrite", pattern: "Bash" },
		];
		const result = capabilitiesToToolList(caps, "qa");
		expect(result).toEqual(["Read", "Bash", "Glob", "Grep"]);
	});
});

// ---------------------------------------------------------------------------
// resolveAllowedTools — role defaults (DB boş döner)
// ---------------------------------------------------------------------------

describe("resolveAllowedTools — rol varsayılanları", () => {
	beforeEach(() => mockListCapabilities.mockResolvedValue(NO_CAPS));

	const fullSet = ["Read", "Edit", "Write", "Bash", "Glob", "Grep"];
	const readOnlySet = ["Read", "Glob", "Grep"];
	const qaSet = ["Read", "Bash", "Glob", "Grep"];

	it.each([
		["frontend-dev", fullSet],
		["backend-dev", fullSet],
		["coder", fullSet],
		["devops", fullSet],
		["data-engineer", fullSet],
		["security-engineer", fullSet],
	])("%s → full tool set", async (role, expected) => {
		const result = await resolveAllowedTools("proj", "agent", role);
		expect(result).toEqual(expected);
	});

	it.each([
		["frontend-reviewer", readOnlySet],
		["backend-reviewer", readOnlySet],
		["reviewer", readOnlySet],
		["product-owner", readOnlySet],
		["design-lead", readOnlySet],
		["designer", readOnlySet],
		["architect", readOnlySet],
		["tech-writer", readOnlySet],
	])("%s → read-only set", async (role, expected) => {
		const result = await resolveAllowedTools("proj", "agent", role);
		expect(result).toEqual(expected);
	});

	it("qa → qa set", async () => {
		const result = await resolveAllowedTools("proj", "agent", "qa");
		expect(result).toEqual(qaSet);
	});

	it("bilinmeyen rol → full tool set", async () => {
		const result = await resolveAllowedTools("proj", "agent", "unknown-role");
		expect(result).toEqual(fullSet);
	});
});

// ---------------------------------------------------------------------------
// resolveAllowedTools — DB yeteneği olan senaryo
// ---------------------------------------------------------------------------

describe("resolveAllowedTools — DB yeteneği ile", () => {
	it("DB kayıtları varsa o araçları döner (role yerine)", async () => {
		const caps: AgentCapability[] = [makeCap("Read"), makeCap("Bash")];
		mockListCapabilities.mockResolvedValue(caps);

		const result = await resolveAllowedTools("proj-1", "agent-1", "frontend-dev");
		expect(result).toEqual(["Read", "Bash"]);
		expect(mockListCapabilities).toHaveBeenCalledWith("proj-1", "agent-1");
	});

	it("DB araç kayıtları yoksa (sadece path kayıtları) role varsayılanına döner", async () => {
		const pathOnlyCap: AgentCapability = {
			id: "x",
			agentId: "a",
			projectId: "p",
			scopeType: "path",
			permission: "readwrite",
			pattern: "src/**",
		};
		mockListCapabilities.mockResolvedValue([pathOnlyCap]);

		const result = await resolveAllowedTools("proj-1", "agent-1", "backend-reviewer");
		expect(result).toEqual(["Read", "Glob", "Grep"]);
	});
});
