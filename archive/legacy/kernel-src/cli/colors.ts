// ---------------------------------------------------------------------------
// CLI Color Helpers — ANSI escape codes (no external dependency)
// ---------------------------------------------------------------------------

const ESC = "\x1b[";

export const colors = {
	reset: `${ESC}0m`,
	bold: `${ESC}1m`,
	dim: `${ESC}2m`,

	// Foreground
	green: `${ESC}32m`,
	red: `${ESC}31m`,
	yellow: `${ESC}33m`,
	gray: `${ESC}90m`,
	cyan: `${ESC}36m`,
	white: `${ESC}37m`,
	blue: `${ESC}34m`,
} as const;

export function green(text: string): string {
	return `${colors.green}${text}${colors.reset}`;
}

export function red(text: string): string {
	return `${colors.red}${text}${colors.reset}`;
}

export function yellow(text: string): string {
	return `${colors.yellow}${text}${colors.reset}`;
}

export function gray(text: string): string {
	return `${colors.gray}${text}${colors.reset}`;
}

export function cyan(text: string): string {
	return `${colors.cyan}${text}${colors.reset}`;
}

export function bold(text: string): string {
	return `${colors.bold}${text}${colors.reset}`;
}

export function dim(text: string): string {
	return `${colors.dim}${text}${colors.reset}`;
}

/** Colorize a task/project status string */
export function colorStatus(status: string): string {
	switch (status) {
		case "done":
		case "completed":
		case "active":
			return green(status);
		case "failed":
		case "error":
			return red(status);
		case "running":
		case "in_progress":
			return yellow(status);
		case "queued":
		case "pending":
		case "waiting":
			return gray(status);
		default:
			return gray(status);
	}
}
