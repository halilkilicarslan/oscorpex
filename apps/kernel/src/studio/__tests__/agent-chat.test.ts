import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Project, ProjectAgent } from "../types.js";

vi.mock("../db.js", () => ({
	getProject: vi.fn(),
	getProjectAgent: vi.fn(),
	insertChatMessage: vi.fn(),
}));

import { chatWithAgent } from "../agent-chat.js";
import { getProject, getProjectAgent, insertChatMessage } from "../db.js";

const mockGetProject = vi.mocked(getProject);
const mockGetAgent = vi.mocked(getProjectAgent);
const mockInsert = vi.mocked(insertChatMessage);

function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
	return {
		id: "agent-1",
		projectId: "p-1",
		name: "Alice",
		role: "frontend-dev",
		avatar: "",
		gender: "female",
		personality: "",
		model: "sonnet",
		cliTool: "claude-code",
		skills: [],
		systemPrompt: "You are a frontend dev.",
		createdAt: new Date().toISOString(),
		color: "#000",
		pipelineOrder: 0,
		...overrides,
	} as ProjectAgent;
}

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "p-1",
		name: "Demo",
		description: "A demo project",
		status: "running",
		techStack: ["typescript"],
		createdAt: new Date().toISOString(),
		...overrides,
	} as Project;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockInsert.mockResolvedValue({} as ChatMessage);
});

describe("chatWithAgent", () => {
	it("throws when agent not found", async () => {
		mockGetAgent.mockResolvedValue(undefined);
		mockGetProject.mockResolvedValue(makeProject());
		await expect(chatWithAgent("p-1", "agent-1", "hi")).rejects.toThrow(/Agent .* not found/);
	});

	it("throws when project not found", async () => {
		mockGetAgent.mockResolvedValue(makeAgent());
		mockGetProject.mockResolvedValue(undefined);
		await expect(chatWithAgent("p-1", "agent-1", "hi")).rejects.toThrow(/Project .* not found/);
	});

	it("rejects cross-project access", async () => {
		mockGetAgent.mockResolvedValue(makeAgent({ projectId: "p-other" }));
		mockGetProject.mockResolvedValue(makeProject());
		await expect(chatWithAgent("p-1", "agent-1", "hi")).rejects.toThrow(/does not belong/);
	});

	it("persists user + agent messages on success", async () => {
		mockGetAgent.mockResolvedValue(makeAgent());
		mockGetProject.mockResolvedValue(makeProject());

		const reply = await chatWithAgent("p-1", "agent-1", "How's it going?");

		expect(typeof reply).toBe("string");
		expect(reply.length).toBeGreaterThan(0);
		expect(mockInsert).toHaveBeenCalledTimes(2);
		expect(mockInsert).toHaveBeenNthCalledWith(1, {
			projectId: "p-1",
			role: "user",
			content: "How's it going?",
			agentId: "agent-1",
		});
		const secondCall = mockInsert.mock.calls[1][0];
		expect(secondCall.role).toBe("assistant");
		expect(secondCall.agentId).toBe("agent-1");
	});

	it("returns a non-empty placeholder response", async () => {
		mockGetAgent.mockResolvedValue(makeAgent({ name: "Bob", role: "qa" }));
		mockGetProject.mockResolvedValue(makeProject());

		const reply = await chatWithAgent("p-1", "agent-1", "what are you working on?");
		expect(reply.trim().length).toBeGreaterThan(0);
	});
});
