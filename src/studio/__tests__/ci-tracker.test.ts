// ---------------------------------------------------------------------------
// Oscorpex — CI Tracker tests (V6 M3)
// GitLabClient + CITracker + webhook processing
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer — must come before imports that use db.js
// ---------------------------------------------------------------------------

const mockCreateCITracking = vi.fn();
const mockUpdateCITracking = vi.fn();
const mockGetCITrackings = vi.fn();
const mockGetCITracking = vi.fn();
const mockDeleteCITracking = vi.fn();

vi.mock("../db.js", () => ({
	createCITracking: (...args: unknown[]) => mockCreateCITracking(...args),
	updateCITracking: (...args: unknown[]) => mockUpdateCITracking(...args),
	getCITrackings: (...args: unknown[]) => mockGetCITrackings(...args),
	getCITracking: (...args: unknown[]) => mockGetCITracking(...args),
	deleteCITracking: (...args: unknown[]) => mockDeleteCITracking(...args),
}));

// Also mock the ci-repo.js used internally by ci-tracker
vi.mock("../db/ci-repo.js", () => ({
	createCITracking: (...args: unknown[]) => mockCreateCITracking(...args),
	updateCITracking: (...args: unknown[]) => mockUpdateCITracking(...args),
	getCITrackings: (...args: unknown[]) => mockGetCITrackings(...args),
	getCITracking: (...args: unknown[]) => mockGetCITracking(...args),
	deleteCITracking: (...args: unknown[]) => mockDeleteCITracking(...args),
}));

import { GitLabClient } from "../gitlab-integration.js";
import { CITracker } from "../ci-tracker.js";
import type { CITracking } from "../db/ci-repo.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTracking(overrides: Partial<CITracking> = {}): CITracking {
	return {
		id: "track-1",
		projectId: "proj-1",
		provider: "github",
		prId: "42",
		prUrl: "https://github.com/acme/repo/pull/42",
		status: "pending",
		details: {},
		pipelineUrl: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// GitLabClient tests
// ---------------------------------------------------------------------------

describe("GitLabClient", () => {
	const BASE = "https://gitlab.example.com";
	const TOKEN = "test-token";

	describe("parseRemoteUrl", () => {
		it("should parse SSH remote URL", () => {
			const result = GitLabClient.parseRemoteUrl("git@gitlab.com:group/project.git");
			expect(result).toEqual({ host: "https://gitlab.com", projectPath: "group/project" });
		});

		it("should parse HTTPS remote URL", () => {
			const result = GitLabClient.parseRemoteUrl("https://gitlab.com/group/sub/project.git");
			expect(result).toEqual({ host: "https://gitlab.com", projectPath: "group/sub/project" });
		});

		it("should parse SSH URL without .git suffix", () => {
			const result = GitLabClient.parseRemoteUrl("git@gitlab.com:user/repo");
			expect(result).toEqual({ host: "https://gitlab.com", projectPath: "user/repo" });
		});

		it("should return null for non-GitLab or unknown URL", () => {
			expect(GitLabClient.parseRemoteUrl("not-a-url")).toBeNull();
		});
	});

	describe("createMergeRequest", () => {
		it("should POST to /projects/:id/merge_requests and return mapped MR", async () => {
			const client = new GitLabClient(BASE, TOKEN);
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					id: 1,
					iid: 10,
					project_id: 5,
					title: "Feature: add login",
					description: "Adds login flow",
					state: "opened",
					web_url: `${BASE}/group/project/-/merge_requests/10`,
					source_branch: "feature/login",
					target_branch: "main",
					created_at: "2026-04-20T00:00:00Z",
					updated_at: "2026-04-20T00:01:00Z",
					merge_status: "can_be_merged",
					sha: "abc123",
					author: { id: 1, username: "dev", name: "Developer" },
				}),
			});
			global.fetch = mockFetch as unknown as typeof fetch;

			const mr = await client.createMergeRequest(5, "feature/login", "main", "Feature: add login", "Adds login flow");

			expect(mockFetch).toHaveBeenCalledOnce();
			const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("/projects/5/merge_requests");
			expect(init.method).toBe("POST");

			expect(mr.iid).toBe(10);
			expect(mr.title).toBe("Feature: add login");
			expect(mr.state).toBe("opened");
			expect(mr.sourceBranch).toBe("feature/login");
		});

		it("should throw on non-OK response", async () => {
			const client = new GitLabClient(BASE, TOKEN);
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				json: async () => ({ message: "Project not found" }),
			}) as unknown as typeof fetch;

			await expect(client.createMergeRequest(999, "a", "b", "t")).rejects.toThrow(/404/);
		});
	});

	describe("getMergeRequestStatus", () => {
		it("should GET /projects/:id/merge_requests/:iid and map result", async () => {
			const client = new GitLabClient(BASE, TOKEN);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					id: 2,
					iid: 5,
					project_id: 10,
					title: "Fix bug",
					description: "",
					state: "merged",
					web_url: `${BASE}/g/p/-/merge_requests/5`,
					source_branch: "fix/bug",
					target_branch: "main",
					created_at: "2026-04-01T00:00:00Z",
					updated_at: "2026-04-02T00:00:00Z",
					merge_status: null,
					sha: null,
					author: null,
				}),
			}) as unknown as typeof fetch;

			const mr = await client.getMergeRequestStatus(10, 5);
			expect(mr.state).toBe("merged");
			expect(mr.author).toBeNull();
		});
	});

	describe("listPipelines", () => {
		it("should GET /projects/:id/pipelines and return array", async () => {
			const client = new GitLabClient(BASE, TOKEN);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => [
					{
						id: 100,
						project_id: 5,
						ref: "main",
						sha: "abc",
						status: "success",
						web_url: `${BASE}/g/p/-/pipelines/100`,
						created_at: "2026-04-20T00:00:00Z",
						updated_at: "2026-04-20T00:05:00Z",
						started_at: "2026-04-20T00:01:00Z",
						finished_at: "2026-04-20T00:05:00Z",
					},
				],
			}) as unknown as typeof fetch;

			const pipelines = await client.listPipelines(5);
			expect(pipelines).toHaveLength(1);
			expect(pipelines[0].status).toBe("success");
			expect(pipelines[0].ref).toBe("main");
		});

		it("should append ref query param when provided", async () => {
			const client = new GitLabClient(BASE, TOKEN);
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => [],
			});
			global.fetch = mockFetch as unknown as typeof fetch;

			await client.listPipelines(5, "feature/login");

			const [url] = mockFetch.mock.calls[0] as [string];
			expect(url).toContain("ref=feature%2Flogin");
		});
	});

	describe("getPipelineStatus", () => {
		it("should GET /projects/:id/pipelines/:pid and return pipeline", async () => {
			const client = new GitLabClient(BASE, TOKEN);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					id: 200,
					project_id: 5,
					ref: "main",
					sha: "def",
					status: "running",
					web_url: `${BASE}/g/p/-/pipelines/200`,
					created_at: "2026-04-20T00:00:00Z",
					updated_at: "2026-04-20T00:02:00Z",
					started_at: "2026-04-20T00:01:00Z",
					finished_at: null,
				}),
			}) as unknown as typeof fetch;

			const pipeline = await client.getPipelineStatus(5, 200);
			expect(pipeline.status).toBe("running");
			expect(pipeline.finishedAt).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// CITracker tests
// ---------------------------------------------------------------------------

describe("CITracker", () => {
	let tracker: CITracker;

	beforeEach(() => {
		vi.clearAllMocks();
		tracker = new CITracker();
		mockCreateCITracking.mockResolvedValue(makeTracking());
		mockUpdateCITracking.mockImplementation(async (id: string, data: Partial<CITracking>) =>
			makeTracking({ id, ...data }),
		);
		mockGetCITrackings.mockResolvedValue([makeTracking()]);
	});

	describe("trackPR", () => {
		it("should create a tracking entry and return trackingId", async () => {
			const result = await tracker.trackPR({
				projectId: "proj-1",
				provider: "github",
				prId: "42",
				prUrl: "https://github.com/acme/repo/pull/42",
			});

			expect(mockCreateCITracking).toHaveBeenCalledOnce();
			expect(result.trackingId).toBe("track-1");
			expect(result.tracking.status).toBe("pending");
		});

		it("should create a gitlab tracking entry", async () => {
			mockCreateCITracking.mockResolvedValue(makeTracking({ provider: "gitlab", prId: "7" }));

			const result = await tracker.trackPR({
				projectId: "proj-1",
				provider: "gitlab",
				prId: "7",
			});

			expect(result.tracking.provider).toBe("gitlab");
		});
	});

	describe("updateStatus", () => {
		it("should update tracking status to running", async () => {
			const updated = await tracker.updateStatus("track-1", "running", { step: "lint" });
			expect(mockUpdateCITracking).toHaveBeenCalledWith("track-1", {
				status: "running",
				details: { step: "lint" },
			});
			expect(updated.id).toBe("track-1");
		});

		it("should pass pipelineUrl when provided", async () => {
			await tracker.updateStatus("track-1", "success", {}, "https://ci.example.com/jobs/1");
			expect(mockUpdateCITracking).toHaveBeenCalledWith("track-1", {
				status: "success",
				details: {},
				pipelineUrl: "https://ci.example.com/jobs/1",
			});
		});
	});

	describe("getTrackingStatus", () => {
		it("should return all trackings for project", async () => {
			const list = await tracker.getTrackingStatus("proj-1");
			expect(mockGetCITrackings).toHaveBeenCalledWith("proj-1");
			expect(list).toHaveLength(1);
		});

		it("should return empty array when no trackings", async () => {
			mockGetCITrackings.mockResolvedValue([]);
			const list = await tracker.getTrackingStatus("proj-empty");
			expect(list).toHaveLength(0);
		});
	});

	describe("processWebhook — GitHub check_run", () => {
		it("should update status to running on in_progress check_run", async () => {
			mockGetCITrackings.mockResolvedValue([makeTracking({ prId: "42" })]);
			mockUpdateCITracking.mockResolvedValue(makeTracking({ status: "running" }));

			const payload = {
				check_run: {
					id: 1,
					name: "CI",
					status: "in_progress",
					conclusion: null,
					html_url: "https://github.com/acme/repo/runs/1",
					pull_requests: [{ number: 42 }],
				},
				repository: { full_name: "acme/repo" },
			};

			const result = await tracker.processWebhook("github", payload, "proj-1");
			expect(result).not.toBeNull();
			expect(result!.status).toBe("running");
		});

		it("should update status to success on completed check_run with success conclusion", async () => {
			mockGetCITrackings.mockResolvedValue([makeTracking({ prId: "10" })]);
			mockUpdateCITracking.mockResolvedValue(makeTracking({ prId: "10", status: "success" }));

			const payload = {
				check_run: {
					status: "completed",
					conclusion: "success",
					html_url: "https://github.com/acme/repo/runs/2",
					pull_requests: [{ number: 10 }],
				},
			};

			const result = await tracker.processWebhook("github", payload, "proj-1");
			expect(result!.status).toBe("success");
		});

		it("should update status to failure on completed check_run with failure conclusion", async () => {
			mockGetCITrackings.mockResolvedValue([makeTracking({ prId: "5" })]);
			mockUpdateCITracking.mockResolvedValue(makeTracking({ prId: "5", status: "failure" }));

			const payload = {
				check_run: {
					status: "completed",
					conclusion: "failure",
					pull_requests: [{ number: 5 }],
				},
			};

			const result = await tracker.processWebhook("github", payload, "proj-1");
			expect(result!.status).toBe("failure");
		});

		it("should return null when check_run has no pull_requests", async () => {
			const payload = {
				check_run: {
					status: "completed",
					conclusion: "success",
					pull_requests: [],
				},
			};

			const result = await tracker.processWebhook("github", payload, "proj-1");
			expect(result).toBeNull();
		});
	});

	describe("processWebhook — GitLab pipeline", () => {
		it("should update status from GitLab pipeline webhook (running)", async () => {
			mockGetCITrackings.mockResolvedValue([makeTracking({ provider: "gitlab", prId: "3" })]);
			mockUpdateCITracking.mockResolvedValue(makeTracking({ provider: "gitlab", prId: "3", status: "running" }));

			const payload = {
				object_kind: "pipeline",
				object_attributes: {
					id: 3,
					ref: "feature/x",
					status: "running",
					web_url: "https://gitlab.com/g/p/-/pipelines/3",
				},
				merge_request: { iid: 3 },
			};

			const result = await tracker.processWebhook("gitlab", payload, "proj-1");
			expect(result).not.toBeNull();
			expect(result!.status).toBe("running");
		});

		it("should normalise GitLab canceled status to cancelled", async () => {
			mockGetCITrackings.mockResolvedValue([makeTracking({ provider: "gitlab", prId: "8" })]);
			mockUpdateCITracking.mockResolvedValue(makeTracking({ provider: "gitlab", status: "cancelled" }));

			const payload = {
				object_kind: "pipeline",
				object_attributes: { id: 8, ref: "main", status: "canceled" },
				merge_request: { iid: 8 },
			};

			const result = await tracker.processWebhook("gitlab", payload, "proj-1");
			// The update was called; value comes from mock
			expect(mockUpdateCITracking).toHaveBeenCalled();
			const callArgs = mockUpdateCITracking.mock.calls[0] as [string, { status: string }];
			expect(callArgs[1].status).toBe("cancelled");
		});

		it("should return null when object_kind is not pipeline", async () => {
			const payload = { object_kind: "push", ref: "main" };
			const result = await tracker.processWebhook("gitlab", payload, "proj-1");
			expect(result).toBeNull();
		});

		it("should return null when no projectId provided", async () => {
			const payload = {
				object_kind: "pipeline",
				object_attributes: { id: 1, status: "success" },
				merge_request: { iid: 1 },
			};
			const result = await tracker.processWebhook("gitlab", payload, undefined);
			expect(result).toBeNull();
		});

		it("should return null when tracking not found for prId", async () => {
			mockGetCITrackings.mockResolvedValue([makeTracking({ provider: "gitlab", prId: "999" })]);

			const payload = {
				object_kind: "pipeline",
				object_attributes: { id: 1, status: "success" },
				merge_request: { iid: 404 },
			};

			const result = await tracker.processWebhook("gitlab", payload, "proj-1");
			expect(result).toBeNull();
		});
	});
});
