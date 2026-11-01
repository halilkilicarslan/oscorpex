// ---------------------------------------------------------------------------
// I0 review fixes — E11: a parent directory swapped for a symlink *after* contained-fs checked it must not let
// unlink or create touch a file outside the root.
// contained-fs exposes no hook, so `realpath` from node:fs/promises is wrapped: right after the realpath of the
// watched parent resolves (i.e. exactly after the "parent is inside the root" check), the parent is replaced by a
// symlink to an outside directory. The swap is synchronous and happens once, so the test is deterministic.
// The swap itself works on any POSIX system; the assertions are about Linux (where the fix is expected to use
// dirfd-relative operations), so the cases run on Linux unless OSCX_RACE_ANY_PLATFORM=1 is set.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTmp } from "./helpers/i0-fakes.js";

const hook = vi.hoisted(() => ({
	watch: undefined as string | undefined,
	onResolved: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		default: actual,
		realpath: async (p: Parameters<typeof actual.realpath>[0], ...rest: unknown[]) => {
			const resolved = await (actual.realpath as (...a: unknown[]) => Promise<string>)(p, ...rest);
			if (hook.watch !== undefined && String(p) === hook.watch) {
				const fire = hook.onResolved;
				hook.watch = undefined;
				hook.onResolved = undefined;
				fire?.();
			}
			return resolved;
		},
	};
});

const runnable = process.platform === "linux" || process.env.OSCX_RACE_ANY_PLATFORM === "1";

let work: string;
let root: string;
let outside: string;

beforeEach(() => {
	work = freshTmp("oscx-i0-rf-race-");
	root = join(work, "root");
	outside = join(work, "outside");
	mkdirSync(join(root, "d"), { recursive: true });
	mkdirSync(outside);
	writeFileSync(join(root, "d", "victim.txt"), "inside\n");
	writeFileSync(join(outside, "victim.txt"), "outside — must survive\n");
});
afterEach(() => {
	hook.watch = undefined;
	hook.onResolved = undefined;
	rmSync(work, { recursive: true, force: true });
});

/** Replaces `<root>/d` with a symlink to the outside directory once the parent check has passed. */
function armSwap() {
	hook.watch = join(root, "d");
	hook.onResolved = () => {
		rmSync(join(root, "d"), { recursive: true, force: true });
		symlinkSync(outside, join(root, "d"));
	};
}

describe("E11: parent swapped for a symlink after the containment check", () => {
	it.skipIf(!runnable)("removeContainedFile does not unlink a file outside the root", async () => {
		const { removeContainedFile } = await import("../security/contained-fs.js");
		armSwap();
		await removeContainedFile(root, "d/victim.txt").catch(() => {});
		expect(existsSync(join(outside, "victim.txt"))).toBe(true);
	});

	it.skipIf(!runnable)("writeContainedFile does not create a file outside the root", async () => {
		const { writeContainedFile } = await import("../security/contained-fs.js");
		armSwap();
		await writeContainedFile(root, "d/created.txt", "payload").catch(() => {});
		expect(existsSync(join(outside, "created.txt"))).toBe(false);
	});

	it.skipIf(!runnable)("the swap hook is live: without a swap the same calls work (precondition)", async () => {
		const { writeContainedFile, removeContainedFile } = await import("../security/contained-fs.js");
		await writeContainedFile(root, "d/created.txt", "payload");
		expect(existsSync(join(root, "d", "created.txt"))).toBe(true);
		await removeContainedFile(root, "d/victim.txt");
		expect(existsSync(join(root, "d", "victim.txt"))).toBe(false);
		expect(existsSync(join(outside, "victim.txt"))).toBe(true);
	});
});
