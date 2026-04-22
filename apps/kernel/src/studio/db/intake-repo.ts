// ---------------------------------------------------------------------------
// Oscorpex — Intake Question Repository (v3.0 B1)
// Interactive Planner: persists clarifying questions asked by the PM agent
// and the user's answers so planning can span multiple turns.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "../pg.js";
import type { IntakeQuestion, IntakeQuestionCategory, IntakeQuestionStatus } from "../types.js";
import { now, rowToIntakeQuestion } from "./helpers.js";
import { createLogger } from "../logger.js";
const log = createLogger("intake-repo");

export interface IntakeQuestionInput {
	question: string;
	options?: string[];
	category?: IntakeQuestionCategory;
	planVersion?: number;
}

/** Bulk-insert questions asked in a single planner turn. */
export async function createIntakeQuestions(
	projectId: string,
	questions: IntakeQuestionInput[],
): Promise<IntakeQuestion[]> {
	if (questions.length === 0) return [];
	const ts = now();
	const created: IntakeQuestion[] = [];

	for (const q of questions) {
		const trimmed = q.question.trim();
		if (!trimmed) continue;
		const id = randomUUID();
		const category = q.category ?? "general";
		const options = q.options ?? [];

		await execute(
			`INSERT INTO intake_questions (
				id, project_id, question, options, category, status, plan_version, created_at
			) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
			[id, projectId, trimmed, JSON.stringify(options), category, q.planVersion ?? null, ts],
		);

		created.push({
			id,
			projectId,
			question: trimmed,
			options,
			category,
			status: "pending",
			planVersion: q.planVersion,
			createdAt: ts,
		});
	}

	return created;
}

export async function getIntakeQuestion(id: string): Promise<IntakeQuestion | null> {
	const row = await queryOne<any>(`SELECT * FROM intake_questions WHERE id = $1`, [id]);
	return row ? rowToIntakeQuestion(row) : null;
}

export async function listIntakeQuestions(projectId: string, status?: IntakeQuestionStatus): Promise<IntakeQuestion[]> {
	const rows = status
		? await query<any>(`SELECT * FROM intake_questions WHERE project_id = $1 AND status = $2 ORDER BY created_at ASC`, [
				projectId,
				status,
			])
		: await query<any>(`SELECT * FROM intake_questions WHERE project_id = $1 ORDER BY created_at ASC`, [projectId]);
	return rows.map(rowToIntakeQuestion);
}

export async function countPendingIntakeQuestions(projectId: string): Promise<number> {
	const row = await queryOne<{ cnt: string }>(
		`SELECT COUNT(*) AS cnt FROM intake_questions WHERE project_id = $1 AND status = 'pending'`,
		[projectId],
	);
	return row ? Number.parseInt(row.cnt, 10) : 0;
}

export async function answerIntakeQuestion(id: string, answer: string): Promise<IntakeQuestion | null> {
	const ts = now();
	await execute(
		`UPDATE intake_questions
		 SET answer = $1, status = 'answered', answered_at = $2
		 WHERE id = $3`,
		[answer, ts, id],
	);
	return getIntakeQuestion(id);
}

export async function skipIntakeQuestion(id: string): Promise<IntakeQuestion | null> {
	const ts = now();
	await execute(
		`UPDATE intake_questions
		 SET status = 'skipped', answered_at = $1
		 WHERE id = $2`,
		[ts, id],
	);
	return getIntakeQuestion(id);
}

export async function clearIntakeQuestions(projectId: string): Promise<void> {
	await execute(`DELETE FROM intake_questions WHERE project_id = $1`, [projectId]);
}
