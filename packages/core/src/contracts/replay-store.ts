// @oscorpex/core — ReplayStore contract
// Interface for saving and retrieving pipeline replay snapshots.

import type { ReplaySnapshot } from "../domain/replay.js";

export interface ReplayStore {
	saveSnapshot(snapshot: ReplaySnapshot): Promise<void>;
	getSnapshot(runId: string, checkpointId?: string): Promise<ReplaySnapshot | null>;
}