import { describe, it, expect } from "vitest";
import { extractProposals, type AgentOutputProposal } from "../cli-runtime.js";

// ---------------------------------------------------------------------------
// 1. Marker extraction from CLI output text
// ---------------------------------------------------------------------------

describe("extractProposals — TASK_PROPOSAL markers", () => {
	it("extracts a single task proposal", () => {
		const text = `I've completed the authentication module.
<!-- TASK_PROPOSAL: {"title": "Add unit tests for auth", "description": "Cover login/logout flows", "proposalType": "test_task"} -->
All done.`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].type).toBe("task_proposal");
		expect(proposals[0].payload.title).toBe("Add unit tests for auth");
		expect(proposals[0].payload.proposalType).toBe("test_task");
	});

	it("extracts multiple task proposals", () => {
		const text = `
<!-- TASK_PROPOSAL: {"title": "Fix CSS layout", "proposalType": "fix_task"} -->
<!-- TASK_PROPOSAL: {"title": "Update docs", "proposalType": "test_task"} -->
`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(2);
		expect(proposals[0].payload.title).toBe("Fix CSS layout");
		expect(proposals[1].payload.title).toBe("Update docs");
	});

	it("enforces max 3 proposals per type", () => {
		const text = Array.from({ length: 5 }, (_, i) =>
			`<!-- TASK_PROPOSAL: {"title": "Task ${i}", "proposalType": "fix_task"} -->`,
		).join("\n");
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(3); // capped at MAX_PROPOSALS_PER_TYPE
	});

	it("ignores invalid JSON in markers", () => {
		const text = `<!-- TASK_PROPOSAL: {invalid json here} -->
<!-- TASK_PROPOSAL: {"title": "Valid task", "proposalType": "fix_task"} -->`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].payload.title).toBe("Valid task");
	});

	it("returns empty for text without markers", () => {
		const text = "Just a normal response with no special markers.";
		expect(extractProposals(text)).toHaveLength(0);
	});
});

describe("extractProposals — AGENT_MESSAGE markers", () => {
	it("extracts agent messages", () => {
		const text = `<!-- AGENT_MESSAGE: {"targetAgentId": "agent-qa", "messageType": "request_info", "content": "Need API spec for auth endpoint"} -->`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].type).toBe("agent_message");
		expect(proposals[0].payload.targetAgentId).toBe("agent-qa");
		expect(proposals[0].payload.messageType).toBe("request_info");
	});

	it("extracts blocker alerts", () => {
		const text = `<!-- AGENT_MESSAGE: {"targetAgentId": "agent-devops", "messageType": "blocker_alert", "content": "Database not accessible"} -->`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].payload.messageType).toBe("blocker_alert");
	});
});

describe("extractProposals — GRAPH_MUTATION markers", () => {
	it("extracts graph mutation proposals", () => {
		const text = `<!-- GRAPH_MUTATION: {"mutationType": "add_edge", "fromTaskId": "task-1", "toTaskId": "task-2", "edgeType": "workflow"} -->`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].type).toBe("graph_mutation");
		expect(proposals[0].payload.mutationType).toBe("add_edge");
	});
});

describe("extractProposals — mixed types", () => {
	it("extracts all types from mixed output", () => {
		const text = `
I found some issues during implementation.
<!-- TASK_PROPOSAL: {"title": "Fix regression in utils", "proposalType": "fix_task"} -->
<!-- AGENT_MESSAGE: {"targetAgentId": "agent-qa", "messageType": "handoff_artifact", "content": "Changed files: auth.ts, utils.ts"} -->
<!-- GRAPH_MUTATION: {"mutationType": "insert_node", "title": "Security review needed"} -->
Done with the task.`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(3);

		const types = proposals.map((p) => p.type);
		expect(types).toContain("task_proposal");
		expect(types).toContain("agent_message");
		expect(types).toContain("graph_mutation");
	});

	it("rate limits each type independently", () => {
		const tasks = Array.from({ length: 5 }, (_, i) =>
			`<!-- TASK_PROPOSAL: {"title": "T${i}", "proposalType": "fix_task"} -->`,
		).join("\n");
		const msgs = Array.from({ length: 5 }, (_, i) =>
			`<!-- AGENT_MESSAGE: {"targetAgentId": "a${i}", "content": "msg"} -->`,
		).join("\n");
		const proposals = extractProposals(tasks + "\n" + msgs);
		const taskProposals = proposals.filter((p) => p.type === "task_proposal");
		const agentMessages = proposals.filter((p) => p.type === "agent_message");
		expect(taskProposals).toHaveLength(3); // capped
		expect(agentMessages).toHaveLength(3); // capped independently
	});
});

describe("extractProposals — edge cases", () => {
	it("handles empty string", () => {
		expect(extractProposals("")).toHaveLength(0);
	});

	it("handles markers with extra whitespace", () => {
		const text = `<!--   TASK_PROPOSAL:   {"title": "Spaced", "proposalType": "fix_task"}   -->`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].payload.title).toBe("Spaced");
	});

	it("ignores non-object JSON (arrays, primitives)", () => {
		const text = `<!-- TASK_PROPOSAL: [1,2,3] -->
<!-- TASK_PROPOSAL: "just a string" -->
<!-- TASK_PROPOSAL: 42 -->`;
		expect(extractProposals(text)).toHaveLength(0);
	});

	it("handles multiline JSON in markers", () => {
		const text = `<!-- TASK_PROPOSAL: {
  "title": "Multiline proposal",
  "description": "This spans\\nmultiple lines",
  "proposalType": "fix_task"
} -->`;
		const proposals = extractProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0].payload.title).toBe("Multiline proposal");
	});
});
