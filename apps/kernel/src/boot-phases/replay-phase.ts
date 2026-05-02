// ---------------------------------------------------------------------------
// Boot Phase — Replay Auto-Checkpoint Wiring
// Subscribes to pipeline events to create replay checkpoints.
// Non-blocking: errors logged as warnings.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { eventBus } from "../studio/event-bus.js";
import { createLogger } from "../studio/logger.js";
import { createCheckpointSnapshot } from "../studio/replay-store.js";

const log = createLogger("boot:replay");

export function replayPhase(): void {
	eventBus.on("pipeline:stage_completed", async (event) => {
		const projectId = event.projectId;
		const stageIndex = (event.payload as any)?.stageIndex ?? "unknown";
		try {
			await createCheckpointSnapshot(projectId, `stage-${stageIndex}`, randomUUID);
			log.info(`Checkpoint created for project ${projectId} at stage ${stageIndex}`);
		} catch (err) {
			log.warn({ err }, `Checkpoint failed for ${projectId}`);
		}
	});

	eventBus.on("pipeline:completed", async (event) => {
		const projectId = event.projectId;
		try {
			await createCheckpointSnapshot(projectId, "final", randomUUID);
			log.info(`Final checkpoint created for project ${projectId}`);
		} catch (err) {
			log.warn({ err }, `Final checkpoint failed for ${projectId}`);
		}
	});

	log.info("Replay auto-checkpoint wiring registered");
}
