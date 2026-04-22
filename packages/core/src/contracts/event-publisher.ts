// @oscorpex/core — EventPublisher contract
// Interface for publishing domain events, both persisted and transient.

import type { BaseEvent, EventType } from "../domain/events.js";

export interface EventPublisher {
	publish<TPayload>(event: BaseEvent<EventType, TPayload>): Promise<void>;
	publishTransient<TPayload>(event: BaseEvent<EventType, TPayload>): void;
}