export interface Span {
  id: string;
  name: string;
  type: 'agent' | 'llm' | 'tool';
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'success' | 'error';
  input?: unknown;
  output?: unknown;
  parentId?: string;
}

export interface Trace {
  id: string;
  agentName: string;
  model: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'success' | 'error';
  spans: Span[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let traces: Trace[] = [];
let nextId = 1;

type Listener = (traces: Trace[]) => void;
const listeners = new Set<Listener>();

function notify() {
  const snapshot = [...traces];
  listeners.forEach((fn) => fn(snapshot));
}

function uid(): string {
  return `${Date.now()}-${nextId++}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new top-level trace for a chat interaction.
 * Returns the traceId so callers can attach spans later.
 */
export function startTrace(agentName: string, model: string): string {
  const id = uid();

  const agentSpan: Span = {
    id: uid(),
    name: agentName,
    type: 'agent',
    startTime: Date.now(),
    status: 'running',
  };

  const llmSpan: Span = {
    id: uid(),
    name: 'LLM call',
    type: 'llm',
    startTime: Date.now(),
    status: 'running',
    parentId: agentSpan.id,
  };

  const trace: Trace = {
    id,
    agentName,
    model,
    startTime: Date.now(),
    status: 'running',
    spans: [agentSpan, llmSpan],
  };

  traces = [trace, ...traces];
  notify();
  return id;
}

/**
 * Add a span to an existing trace (e.g. a tool invocation).
 */
export function addSpan(traceId: string, span: Omit<Span, 'id'>): void {
  traces = traces.map((t) => {
    if (t.id !== traceId) return t;
    const newSpan: Span = { id: uid(), ...span };
    return { ...t, spans: [...t.spans, newSpan] };
  });
  notify();
}

/**
 * Close a span inside a trace.
 */
export function completeSpan(
  traceId: string,
  spanMatcher: (span: Span) => boolean,
  status: 'success' | 'error' = 'success',
  output?: unknown,
): void {
  traces = traces.map((t) => {
    if (t.id !== traceId) return t;
    const endTime = Date.now();
    const spans = t.spans.map((s) => {
      if (!spanMatcher(s)) return s;
      return {
        ...s,
        endTime,
        duration: endTime - s.startTime,
        status,
        output,
      };
    });
    return { ...t, spans };
  });
  notify();
}

/**
 * Mark a trace as completed (success or error).
 * Optionally attach token usage information.
 */
export function completeTrace(
  traceId: string,
  tokens?: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
  status: 'success' | 'error' = 'success',
): void {
  const endTime = Date.now();

  traces = traces.map((t) => {
    if (t.id !== traceId) return t;

    // Close any spans that are still running
    const spans = t.spans.map((s) => {
      if (s.status !== 'running') return s;
      return {
        ...s,
        endTime,
        duration: endTime - s.startTime,
        status: status as 'success' | 'error',
      };
    });

    return {
      ...t,
      endTime,
      duration: endTime - t.startTime,
      status,
      spans,
      ...(tokens ?? {}),
    };
  });

  notify();
}

/** Get a snapshot of all recorded traces (most-recent first). */
export function getTraces(): Trace[] {
  return traces;
}

/** Remove all recorded traces. */
export function clearTraces(): void {
  traces = [];
  notify();
}

/**
 * Subscribe to trace changes.
 * Returns an unsubscribe function.
 */
export function subscribeToTraces(callback: Listener): () => void {
  listeners.add(callback);
  // Immediately deliver the current state to the new subscriber
  callback([...traces]);
  return () => {
    listeners.delete(callback);
  };
}
