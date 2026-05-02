// ---------------------------------------------------------------------------
// Pipeline Branch Manager
// Git/VCS operations for pipeline phase branches:
//   - createPhaseBranch  — creates a git branch at stage start
//   - mergePhaseBranchToMain — merges phase branch to main at stage end
//   - tryCreatePR        — creates a GitHub PR when pipeline completes
// ---------------------------------------------------------------------------

import { getProject, getProjectSetting } from "./db.js";
import { eventBus } from "./event-bus.js";
import { gitManager } from "./git-manager.js";
import { GitHubIntegration } from "./github-integration.js";
import { createLogger } from "./logger.js";
import { decrypt, isEncrypted } from "./secret-vault.js";
import type { PipelineStage } from "./types.js";

const log = createLogger("pipeline-branch-manager");

export class PipelineBranchManager {
	/**
	 * Phase başlangıcında `phase/{stageIndex}-{agentRoles}` formatında
	 * git branch oluşturur. Başarısızlık pipeline'ı durdurmaz.
	 */
	async createPhaseBranch(projectId: string, stageIndex: number, stage: PipelineStage): Promise<void> {
		const project = await getProject(projectId);
		if (!project?.repoPath) return;

		// Branch adı: phase/0-backend, phase/1-frontend vb.
		const roleSlug = stage.agents
			.map((a) => a.role.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
			.join("-")
			.slice(0, 30); // Git branch adı sınırı
		const branchName = `phase/${stageIndex}-${roleSlug || "stage"}`;

		try {
			const branches = await gitManager.listBranches(project.repoPath);
			if (branches.includes(branchName)) {
				// Branch zaten varsa geçiş yap
				await gitManager.checkout(project.repoPath, branchName);
			} else {
				// Yeni branch oluştur
				await gitManager.createBranch(project.repoPath, branchName);
			}

			eventBus.emit({
				projectId,
				type: "pipeline:branch_created",
				payload: { branch: branchName, stageIndex },
			});
		} catch (err) {
			log.warn(`[pipeline-branch-manager] Branch oluşturulamadı: ${branchName}` + " " + String(err));
		}
	}

	/**
	 * Tamamlanan phase branch'ini main'e merge eder.
	 * Commit'lenecek değişiklik varsa önce commit atar.
	 * Conflict durumunda uyarı log'u bırakır ama pipeline devam eder.
	 */
	async mergePhaseBranchToMain(projectId: string, stageIndex: number, stage: PipelineStage): Promise<void> {
		const project = await getProject(projectId);
		if (!project?.repoPath) return;

		const roleSlug = stage.agents
			.map((a) => a.role.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
			.join("-")
			.slice(0, 30);
		const branchName = `phase/${stageIndex}-${roleSlug || "stage"}`;

		try {
			// Aktif branch bu phase branch'i mi kontrol et
			const currentBranch = await gitManager.getCurrentBranch(project.repoPath);
			if (currentBranch !== branchName) return; // Farklı branch'teyiz, işlem yapma

			// Uncommitted değişiklik varsa commit at
			const status = await gitManager.getStatus(project.repoPath);
			const hasChanges = status.modified.length > 0 || status.untracked.length > 0 || status.staged.length > 0;

			if (hasChanges) {
				await gitManager.commit(
					project.repoPath,
					`feat: phase ${stageIndex} tamamlandı (${roleSlug || "stage"})`,
				);
			}

			// main branch'e merge et
			const result = await gitManager.mergeBranch(project.repoPath, branchName, "main");

			if (result.success) {
				eventBus.emit({
					projectId,
					type: "pipeline:branch_merged",
					payload: { branch: branchName, target: "main", stageIndex },
				});
			} else {
				// Conflict varsa main'e geri dön
				log.warn(
					`[pipeline-branch-manager] Merge conflict tespit edildi: ${branchName} → main` +
						" " +
						String(result.conflicts),
				);
				await gitManager
					.checkout(project.repoPath, "main")
					.catch((err) =>
						log.warn("[pipeline-branch-manager] Non-blocking operation failed:", err?.message ?? err),
					);
			}
		} catch (err) {
			log.warn(`[pipeline-branch-manager] Branch merge atlandı: ${branchName}` + " " + String(err));
		}
	}

	/**
	 * Pipeline tamamlandığında otomatik PR oluşturma.
	 * GitHub token ve auto_pr ayarı kontrol edilir.
	 */
	async tryCreatePR(projectId: string): Promise<void> {
		const autoPR = await getProjectSetting(projectId, "github", "auto_pr");
		if (autoPR !== "true") return;

		const tokenEncrypted = await getProjectSetting(projectId, "github", "token");
		if (!tokenEncrypted) return;

		const project = await getProject(projectId);
		if (!project?.repoPath) return;

		const repoInfo = GitHubIntegration.getRepoInfo(project.repoPath);
		if (!repoInfo) return;

		const token = isEncrypted(tokenEncrypted) ? decrypt(tokenEncrypted) : tokenEncrypted;
		const currentBranch = await gitManager.getCurrentBranch(project.repoPath);
		if (!currentBranch || currentBranch === "main" || currentBranch === "master") return;

		const gh = new GitHubIntegration(token);
		const pr = await gh.createPR({
			owner: repoInfo.owner,
			repo: repoInfo.repo,
			head: currentBranch,
			base: "main",
			title: `[Oscorpex] ${project.name} — Pipeline Completed`,
			body: `Automated PR from Oscorpex pipeline.\n\nProject: ${project.name}\nBranch: ${currentBranch}`,
		});

		log.info(`[pipeline-branch-manager] PR oluşturuldu: ${pr.url}`);

		eventBus.emit({
			projectId,
			type: "git:pr-created" as any,
			payload: { prNumber: pr.number, prUrl: pr.url, branch: currentBranch },
		});
	}
}
