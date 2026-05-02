// ---------------------------------------------------------------------------
// Oscorpex — Pipeline Task Hook
// Registers TaskEngine completion hooks and coalesces stage advancement.
// ---------------------------------------------------------------------------

import { getPipelineRun, listProjectAgents } from "../db.js";
import { createLogger } from "../logger.js";
import { taskEngine } from "../task-engine.js";

const log = createLogger("pipeline-task-hook");

export class PipelineTaskHook {
	private registered = false;
	private readonly advancePending = new Map<string, NodeJS.Timeout>();

	constructor(
		private readonly advanceStage: (projectId: string) => Promise<unknown>,
		private readonly startPipeline: (projectId: string) => Promise<unknown>,
	) {}

	register(): void {
		if (this.registered) return;
		this.registered = true;

		taskEngine.onTaskCompleted((taskId, projectId) => {
			getPipelineRun(projectId)
				.then(async (run) => {
					if (run && run.status === "running") {
						this.debouncedAdvance(projectId);
						return;
					}

					if (!run || run.status === "idle" || run.status === "failed") {
						try {
							const agents = await listProjectAgents(projectId);
							if (agents.length > 0) {
								log.info(
									`[pipeline-engine] Task tamamlandı ama pipeline başlatılmamış; otomatik başlatılıyor (proje=${projectId})`,
								);
								await this.startPipeline(projectId);
								this.debouncedAdvance(projectId);
							}
						} catch (err) {
							log.error(
								`[pipeline-engine] otomatik pipeline başlatma hatası (proje=${projectId}):` + " " + String(err),
							);
						}
					}
				})
				.catch((err) => {
					log.error(`[pipeline-engine] getPipelineRun hatası (proje=${projectId}):` + " " + String(err));
				});
		});
	}

	debouncedAdvance(projectId: string): void {
		const existing = this.advancePending.get(projectId);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.advancePending.delete(projectId);
			this.advanceStage(projectId).catch((err) => {
				log.error(`[pipeline-engine] advanceStage hatası (proje=${projectId}):` + " " + String(err));
			});
		}, 200);
		this.advancePending.set(projectId, timer);
	}
}
