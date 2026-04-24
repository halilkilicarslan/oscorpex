// @oscorpex/core — ReplayStore contract
// Interface for saving and retrieving pipeline replay snapshots.

import type { ReplaySnapshot } from "../domain/replay.js";

export interface ReplayStore {
	saveSnapshot(snapshot: ReplaySnapshot): Promise<void>;
	getSnapshot(runId: string, checkpointId?: string): Promise<ReplaySnapshot | null>;
	listSnapshots(runId: string, limit?: number): Promise<ReplaySnapshot[]>;
	pruneSnapshots(runId: string, maxDepth: number): Promise<number>;
}