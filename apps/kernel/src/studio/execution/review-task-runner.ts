// ---------------------------------------------------------------------------
// Oscorpex — Review Task Runner
// Keeps review task execution behind the execution module boundary.
// ---------------------------------------------------------------------------

import { agentRuntime } from "../agent-runtime.js";
import { executeReviewTask } from "../review-dispatcher.js";
import type { Project, Task } from "../types.js";

export async function executeTaskReview(projectId: string, project: Project, task: Task): Promise<void> {
	await executeReviewTask(projectId, project, task, agentRuntime);
}
