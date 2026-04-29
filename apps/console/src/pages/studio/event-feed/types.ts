export type EventType =
	| 'plan:approved'
	| 'plan:rejected'
	| 'execution:started'
	| 'task:assigned'
	| 'task:started'
	| 'task:completed'
	| 'task:failed'
	| 'phase:started'
	| 'phase:completed'
	| 'project:completed'
	| 'escalation';

export interface StudioEvent {
	id: string;
	type: EventType | string;
	payload: Record<string, unknown>;
	timestamp: string;
}

export interface EventStyle {
	icon: React.ReactNode;
	labelColor: string;
	dotColor: string;
	borderColor: string;
}
