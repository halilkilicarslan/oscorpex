// ---------------------------------------------------------------------------
// Oscorpex — Lightweight OpenTelemetry-compatible Tracing Module (V6 M5 F7)
// Zero external dependencies — pure Node.js implementation.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpanStatus = "ok" | "error" | "unset";

export interface SpanEvent {
	name: string;
	timestamp: number;
	attributes?: Record<string, string | number | boolean>;
}

export interface Span {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	startTime: number;
	endTime?: number;
	status: SpanStatus;
	attributes: Record<string, string | number | boolean>;
	events: SpanEvent[];
}

export interface SpanExporter {
	export(spans: Span[]): void;
}

export interface StartSpanOptions {
	parentSpanId?: string;
	traceId?: string;
	attributes?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// ConsoleExporter — Structured JSON logging to stdout
// ---------------------------------------------------------------------------

export class ConsoleExporter implements SpanExporter {
	export(spans: Span[]): void {
		for (const span of spans) {
			const durationMs = span.endTime !== undefined ? span.endTime - span.startTime : null;
			console.log(
				JSON.stringify({
					type: "otel.span",
					traceId: span.traceId,
					spanId: span.spanId,
					parentSpanId: span.parentSpanId ?? null,
					name: span.name,
					status: span.status,
					startTime: span.startTime,
					endTime: span.endTime ?? null,
					durationMs,
					attributes: span.attributes,
					events: span.events,
				}),
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Circular buffer for completed spans (max 1000)
// ---------------------------------------------------------------------------

const MAX_SPANS = 1000;

class CircularBuffer<T> {
	private buf: T[] = [];
	private head = 0;
	private _size = 0;
	private capacity: number;

	constructor(capacity: number) {
		this.capacity = capacity;
		this.buf = new Array(capacity);
	}

	push(item: T): void {
		this.buf[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this._size < this.capacity) this._size++;
	}

	/** Returns items newest-first */
	toArray(): T[] {
		if (this._size === 0) return [];
		const result: T[] = new Array(this._size);
		for (let i = 0; i < this._size; i++) {
			const idx = (this.head - 1 - i + this.capacity) % this.capacity;
			result[i] = this.buf[idx];
		}
		return result;
	}

	get size(): number {
		return this._size;
	}

	clear(): void {
		this.buf = new Array(this.capacity);
		this.head = 0;
		this._size = 0;
	}
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export class Tracer {
	private activeSpans = new Map<string, Span>();
	private completedSpans = new CircularBuffer<Span>(MAX_SPANS);
	private exporter: SpanExporter;
	private enabled: boolean;

	constructor(exporter?: SpanExporter) {
		this.exporter = exporter ?? new ConsoleExporter();
		this.enabled = process.env.OSCORPEX_TRACE_ENABLED === "true";
	}

	get isEnabled(): boolean {
		return this.enabled;
	}

	// For testing — allow overriding enabled state
	setEnabled(value: boolean): void {
		this.enabled = value;
	}

	// ---------------------------------------------------------------------------
	// Core API
	// ---------------------------------------------------------------------------

	startSpan(name: string, opts?: StartSpanOptions): Span {
		const spanId = randomUUID();
		const traceId = opts?.traceId ?? randomUUID();
		const span: Span = {
			traceId,
			spanId,
			parentSpanId: opts?.parentSpanId,
			name,
			startTime: Date.now(),
			status: "unset",
			attributes: { ...(opts?.attributes ?? {}) },
			events: [],
		};
		this.activeSpans.set(spanId, span);
		return span;
	}

	endSpan(span: Span, status?: SpanStatus): void {
		span.endTime = Date.now();
		span.status = status ?? (span.status === "unset" ? "ok" : span.status);
		this.activeSpans.delete(span.spanId);
		this.completedSpans.push(span);

		if (this.enabled) {
			this.exporter.export([span]);
		}
	}

	addEvent(span: Span, name: string, attributes?: Record<string, string | number | boolean>): void {
		span.events.push({
			name,
			timestamp: Date.now(),
			attributes,
		});
	}

	setAttribute(span: Span, key: string, value: string | number | boolean): void {
		span.attributes[key] = value;
	}

	getActiveSpans(): Span[] {
		return Array.from(this.activeSpans.values());
	}

	getRecentSpans(limit = 50): Span[] {
		const all = this.completedSpans.toArray();
		return limit > 0 ? all.slice(0, limit) : all;
	}

	/**
	 * Wrap an async function with a span. Automatically ends the span on
	 * resolve (status: ok) or reject (status: error). Always re-throws errors.
	 */
	async withSpan<T>(name: string, fn: (span: Span) => Promise<T>, opts?: StartSpanOptions): Promise<T> {
		const span = this.startSpan(name, opts);
		try {
			const result = await fn(span);
			this.endSpan(span, "ok");
			return result;
		} catch (err) {
			this.setAttribute(span, "error.message", err instanceof Error ? err.message : String(err));
			this.endSpan(span, "error");
			throw err;
		}
	}

	/**
	 * flush — Export all completed spans and clear the buffer.
	 * Useful for test teardown or graceful shutdown.
	 */
	flush(): void {
		const spans = this.completedSpans.toArray();
		if (spans.length > 0 && this.enabled) {
			this.exporter.export(spans);
		}
		this.completedSpans.clear();
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const tracer = new Tracer();
