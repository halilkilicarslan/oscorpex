// ---------------------------------------------------------------------------
// app-runner/state.ts — In-memory running apps registry
// ---------------------------------------------------------------------------

import type { RunningService } from "./types.js";

export const runningApps = new Map<
	string,
	{
		services: RunningService[];
		previewService: string;
	}
>();
