// ---------------------------------------------------------------------------
// Oscorpex — Chat & Agent Message Types
// ---------------------------------------------------------------------------

// ---- Chat Messages ---------------------------------------------------------

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
	id: string;
	projectId: string;
	role: ChatRole;
	content: string;
	agentId?: string;
	createdAt: string;
}

// ---- Agent Messages (ajan-arası iletişim) ----------------------------------

export type MessageType =
	| "task_assignment"
	| "task_complete"
	| "review_request"
	| "bug_report"
	| "feedback"
	| "notification"
	// v3.6: Agent ceremonies & communication
	| "standup"
	| "retrospective"
	| "conflict"
	| "help_request"
	| "pair_session"
	| "handoff_doc";

export type MessageStatus = "unread" | "read" | "archived";

export interface AgentMessage {
	id: string;
	projectId: string;
	fromAgentId: string;
	toAgentId: string;
	type: MessageType;
	subject: string;
	content: string;
	metadata: Record<string, any>;
	status: MessageStatus;
	parentMessageId?: string;
	createdAt: string;
	readAt?: string;
}
