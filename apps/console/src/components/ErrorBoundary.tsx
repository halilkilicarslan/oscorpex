import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("[ErrorBoundary] Caught error:", error, errorInfo);
		this.props.onError?.(error, errorInfo);
	}

	render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;

			return (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "200px",
						padding: "2rem",
						color: "#a1a1aa",
						fontFamily: "monospace",
					}}
				>
					<div
						style={{
							fontSize: "1.25rem",
							fontWeight: 600,
							color: "#ef4444",
							marginBottom: "0.75rem",
						}}
					>
						Something went wrong
					</div>
					<div
						style={{
							fontSize: "0.875rem",
							marginBottom: "1rem",
							maxWidth: "500px",
							textAlign: "center",
						}}
					>
						{this.state.error?.message || "An unexpected error occurred"}
					</div>
					<button
						type="button"
						onClick={() => this.setState({ hasError: false, error: null })}
						style={{
							padding: "0.5rem 1rem",
							background: "#22c55e",
							color: "#0a0a0a",
							border: "none",
							borderRadius: "0.375rem",
							cursor: "pointer",
							fontWeight: 500,
							fontSize: "0.875rem",
						}}
					>
						Try Again
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
