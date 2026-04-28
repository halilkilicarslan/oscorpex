// ---------------------------------------------------------------------------
// Operator Actions — Domain Types
// ---------------------------------------------------------------------------

export type OperatorActionType =
	| "provider_disable"
	| "provider_enable"
	| "retry_task"
	| "cancel_task"
	| "pause_queue"
	| "resume_queue"
	| "reset_cooldown";

export interface OperatorActionRequest {
	actionType: OperatorActionType;
	targetId?: string;
	targetType?: string;
	actor: string;
	reason: string;
	metadata?: Record<string, unknown>;
}

export interface OperatorActionResult {
	id: string;
	actionType: OperatorActionType;
	targetId?: string;
	status: "success" | "failed" | "skipped";
	message: string;
	createdAt: string;
}

export interface OperatorActionRow {
	id: string;
	action_type: string;
	target_id: string | null;
	target_type: string | null;
	actor: string;
	reason: string;
	status: string;
	result: string;
	created_at: string;
}

export interface OperatorFlagRow {
	key: string;
	value: string;
	set_by: string;
	reason: string;
	updated_at: string;
}
