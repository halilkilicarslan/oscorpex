// ---------------------------------------------------------------------------
// Boot Phase Types
// Defines the result taxonomy for boot phase execution.
// ---------------------------------------------------------------------------

export type BootPhaseSeverity = "fatal" | "error" | "warning" | "skip-allowed";

export interface BootPhaseResult<T = void> {
	ok: boolean;
	severity: BootPhaseSeverity;
	data?: T;
	err?: Error | unknown;
}

export interface BootPhaseConfig {
	name: string;
	severity: BootPhaseSeverity;
	/** If true, the phase is executed but failures are swallowed. */
	swallowErrors?: boolean;
}
