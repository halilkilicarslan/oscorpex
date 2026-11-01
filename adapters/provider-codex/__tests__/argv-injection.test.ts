// ---------------------------------------------------------------------------
// CodexAdapter — a prompt that looks like an option must never be parsed as one, and must not sit in argv
// (visible to every local user in `ps`). It reaches the CLI on stdin, or at least after a `--` separator.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "../src/index.js";

const mockRunCLI = vi.fn();
const mockCheckBinaryAsync = vi.fn();

vi.mock("@oscorpex/provider-sdk", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		runCLI: (...args: unknown[]) => mockRunCLI(...args),
		checkBinaryAsync: (...args: unknown[]) => mockCheckBinaryAsync(...args),
	};
});

const HOSTILE = "--config=x hello";

describe("CodexAdapter prompt delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckBinaryAsync.mockResolvedValue({ available: true });
		mockRunCLI.mockResolvedValue({
			exitCode: 0,
			signal: null,
			stdout: "done",
			stderr: "",
			durationMs: 10,
			killedByTimeout: false,
			killedBySignal: false,
		});
	});

	async function run(prompt: string) {
		await new CodexAdapter().execute({
			runId: "r1",
			taskId: "t1",
			provider: "codex",
			repoPath: "/tmp",
			prompt,
			timeoutMs: 5000,
		});
		return mockRunCLI.mock.calls[0][0] as { args: string[]; stdin?: string };
	}

	it("an option-shaped prompt is never in argv before a `--` separator", async () => {
		const call = await run(HOSTILE);
		const dd = call.args.indexOf("--");
		const offenders = call.args.map((a, i) => ({ a, i })).filter(({ a }) => a.includes("--config=x"));
		for (const { i } of offenders) expect(dd !== -1 && i > dd).toBe(true);
		expect(call.args.some((a) => a === HOSTILE)).toBe(dd !== -1);
	});

	it("the prompt is delivered on stdin and does not appear in argv (visible in `ps`)", async () => {
		const call = await run(HOSTILE);
		expect(call.stdin ?? "").toContain(HOSTILE);
		expect(call.args.join("\n")).not.toContain("hello");
	});

	it("the model flag is still passed as an option (regression)", async () => {
		const call = await run("plain prompt");
		expect(call.args).toContain("--model");
	});
});
