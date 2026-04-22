// @oscorpex/core — RunStore contract
// Interface for run persistence and retrieval.

import type { Run } from "../domain/run.js";

export interface RunStore {
	create(run: Run): Promise<Run>;
	get(id: string): Promise<Run | null>;
	update(id: string, partial: Partial<Run>): Promise<Run>;
	list(filter: RunListFilter): Promise<Run[]>;
}

export interface RunListFilter {
	projectId?: string;
	status?: string;
	limit?: number;
	offset?: number;
}