// ---------------------------------------------------------------------------
// Oscorpex — Capability Resolver
// Agent rolüne veya DB'deki yetenek kayıtlarına göre izin verilen CLI araçlarını çözer.
// ---------------------------------------------------------------------------

import { listAgentCapabilities } from "./db.js";
import { createLogger } from "./logger.js";
import { canonicalizeAgentRole } from "./roles.js";
import type { AgentCapability } from "./types.js";
const log = createLogger("capability-resolver");

// Rol bazlı varsayılan araç listeleri
function getDefaultToolsForRole(role: string): string[] {
	switch (canonicalizeAgentRole(role)) {
		case "frontend-dev":
		case "backend-dev":
		case "coder":
		case "devops":
		case "data-engineer":
		case "security-engineer":
			return ["Read", "Edit", "Write", "Bash", "Glob", "Grep"];

		case "frontend-reviewer":
		case "backend-reviewer":
		case "reviewer":
		case "security-reviewer":
			return ["Read", "Glob", "Grep"];

		case "qa":
			return ["Read", "Bash", "Glob", "Grep"];

		case "product-owner":
		case "design-lead":
		case "designer":
		case "architect":
		case "tech-writer":
			return ["Read", "Glob", "Grep"];

		case "docs-writer":
			return ["Read", "Edit", "Write", "Glob", "Grep"];

		default:
			return ["Read", "Edit", "Write", "Bash", "Glob", "Grep"];
	}
}

// Yetenek listesinden araç adlarını çıkarır; uygun kayıt yoksa role fallback yapar
export function capabilitiesToToolList(capabilities: AgentCapability[], role: string): string[] {
	const toolCaps = capabilities.filter((cap) => cap.scopeType === "tool" && cap.permission === "allow");
	if (toolCaps.length === 0) return getDefaultToolsForRole(role);
	return toolCaps.map((cap) => cap.pattern);
}

// DB'deki yetenek kayıtlarına bakarak izin verilen araçları döner; kayıt yoksa role varsayılanı kullanır
export async function resolveAllowedTools(projectId: string, agentId: string, agentRole: string): Promise<string[]> {
	const capabilities = await listAgentCapabilities(projectId, agentId);
	return capabilitiesToToolList(capabilities, agentRole);
}
