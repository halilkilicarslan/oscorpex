import { describe, expect, it, vi } from "vitest";
import { GitHubIntegration } from "../github-integration.js";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
const mockExecSync = vi.mocked(execSync);

describe("GitHubIntegration (Faz 2.1)", () => {
	describe("getRepoInfo", () => {
		it("should parse SSH remote URL", () => {
			mockExecSync.mockReturnValue("git@github.com:acme/my-project.git\n" as any);
			const info = GitHubIntegration.getRepoInfo("/fake/path");
			expect(info).toEqual({ owner: "acme", repo: "my-project" });
		});

		it("should parse HTTPS remote URL", () => {
			mockExecSync.mockReturnValue("https://github.com/acme/my-project.git\n" as any);
			const info = GitHubIntegration.getRepoInfo("/fake/path");
			expect(info).toEqual({ owner: "acme", repo: "my-project" });
		});

		it("should return null for non-GitHub remote", () => {
			mockExecSync.mockReturnValue("https://gitlab.com/acme/project.git\n" as any);
			const info = GitHubIntegration.getRepoInfo("/fake/path");
			expect(info).toBeNull();
		});

		it("should return null when git command fails", () => {
			mockExecSync.mockImplementation(() => {
				throw new Error("not a repo");
			});
			const info = GitHubIntegration.getRepoInfo("/nonexistent");
			expect(info).toBeNull();
		});

		it("should handle SSH URL without .git suffix", () => {
			mockExecSync.mockReturnValue("git@github.com:user/repo\n" as any);
			const info = GitHubIntegration.getRepoInfo("/fake/path");
			expect(info).toEqual({ owner: "user", repo: "repo" });
		});
	});

	describe("createPR", () => {
		it("should call octokit.pulls.create with correct params", async () => {
			const mockCreate = vi.fn().mockResolvedValue({
				data: { number: 42, html_url: "https://github.com/acme/repo/pull/42", title: "Test PR" },
			});

			const gh = new GitHubIntegration("fake-token");
			(gh as any).octokit = { pulls: { create: mockCreate } };

			const result = await gh.createPR({
				owner: "acme",
				repo: "repo",
				head: "feature/test",
				base: "main",
				title: "Test PR",
				body: "PR body",
			});

			expect(mockCreate).toHaveBeenCalledWith({
				owner: "acme",
				repo: "repo",
				head: "feature/test",
				base: "main",
				title: "Test PR",
				body: "PR body",
			});
			expect(result).toEqual({
				number: 42,
				url: "https://github.com/acme/repo/pull/42",
				title: "Test PR",
			});
		});
	});
});
