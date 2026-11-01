// ---------------------------------------------------------------------------
// Validation of request-supplied git arguments. A value that starts with `-` is an option to git (`--output=<file>`
// writes a file, `--orphan=…` moves HEAD, `--chmod=+x` changes modes); routes answer 400 for it and the git manager
// rejects it again, then passes revisions after `--end-of-options` (merge, revert, diff) and paths after `--` as defence
// in depth. `checkout` instead takes the branch followed by a trailing `--` (it has no `--end-of-options` before git 2.43).
// ---------------------------------------------------------------------------

const REF_RX = /^[A-Za-z0-9_][A-Za-z0-9_./@{}^~+-]*$/;
const SHA_RX = /^[0-9a-f]{4,64}$/i;

export class InvalidGitInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidGitInputError";
	}
}

/** A branch / tag / revision name: never empty, never option-shaped, no whitespace/control characters. */
export function isSafeGitRef(value: unknown): value is string {
	return typeof value === "string" && value.length <= 250 && REF_RX.test(value) && !value.includes("..");
}

export function isGitSha(value: unknown): value is string {
	return typeof value === "string" && SHA_RX.test(value);
}

/** A repo-relative pathspec: not option-shaped, no NUL/newline. */
export function isSafeGitPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 1000 &&
		!value.startsWith("-") &&
		!/[\0\n\r]/.test(value)
	);
}

export function assertGitRef(value: unknown, label = "ref"): string {
	if (!isSafeGitRef(value)) throw new InvalidGitInputError(`Invalid ${label}`);
	return value;
}

export function assertGitSha(value: unknown, label = "commit hash"): string {
	if (!isGitSha(value)) throw new InvalidGitInputError(`Invalid ${label}`);
	return value;
}

export function assertGitPaths(values: unknown, label = "file path"): string[] {
	if (!Array.isArray(values) || !values.every(isSafeGitPath)) throw new InvalidGitInputError(`Invalid ${label}`);
	return values as string[];
}
