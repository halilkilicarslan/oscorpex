// @oscorpex/kernel — Provider Cancel Behavior Matrix
// Documents how each provider handles cancellation and what the registry does.
//
// | Provider      | supportsCancel | Registry Behavior               | Adapter Behavior                          |
// |---------------|----------------|----------------------------------|-------------------------------------------|
// | claude-code   | true           | AbortController.signal aborts   | Signal forwarded to legacy.execute()      |
// | codex         | false          | AbortController.signal aborts   | No-op (signal not forwarded to legacy)    |
// | cursor        | false          | AbortController.signal aborts   | No-op (signal not forwarded to legacy)    |
//
// Registry always creates an AbortController per execution. cancel() aborts
// the signal and propagates to adapter.cancel(). Adapters with supportsCancel=false
// still receive the cancel() call for cleanup/logging but do not forward to legacy.
//
// Future: native adapters should implement true cancel (e.g., process.kill, API abort).

export const CANCEL_BEHAVIOR_MATRIX = {
	"claude-code": {
		supportsCancel: true,
		mechanism: "AbortController.signal forwarded to legacy CLI adapter",
		granularity: "per-execution (runId:taskId)",
		cleanup: "signal propagated, adapter logs cancellation",
	},
	codex: {
		supportsCancel: false,
		mechanism: "AbortController.signal aborts at registry level only",
		granularity: "per-execution (runId:taskId)",
		cleanup: "registry removes controller; adapter no-op",
	},
	cursor: {
		supportsCancel: false,
		mechanism: "AbortController.signal aborts at registry level only",
		granularity: "per-execution (runId:taskId)",
		cleanup: "registry removes controller; adapter no-op",
	},
} as const;

export type CancelBehaviorEntry = (typeof CANCEL_BEHAVIOR_MATRIX)[keyof typeof CANCEL_BEHAVIOR_MATRIX];