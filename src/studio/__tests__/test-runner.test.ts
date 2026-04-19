// ---------------------------------------------------------------------------
// Oscorpex — TestRunner unit tests (V6 M2)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fs/promises so detectFramework works without a real filesystem
// ---------------------------------------------------------------------------

const mockAccess = vi.fn<(p: string) => Promise<void>>();
const mockReadFile = vi.fn<(p: string, enc: string) => Promise<string>>();

vi.mock("node:fs/promises", () => ({
	access: (...args: unknown[]) => mockAccess(args[0] as string),
	readFile: (...args: unknown[]) => mockReadFile(args[0] as string, args[1] as string),
}));

// Mock child_process so runTests doesn't actually spawn anything
const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { TestRunner } from "../test-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunner() {
	return new TestRunner();
}

// Minimal EventEmitter-like mock for spawn
function makeChildMock(stdout: string, stderr = "", exitCode = 0) {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	const stdoutListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	const stderrListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

	const child = {
		stdout: {
			on(event: string, cb: (...args: unknown[]) => void) {
				stdoutListeners[event] = [...(stdoutListeners[event] ?? []), cb];
			},
		},
		stderr: {
			on(event: string, cb: (...args: unknown[]) => void) {
				stderrListeners[event] = [...(stderrListeners[event] ?? []), cb];
			},
		},
		on(event: string, cb: (...args: unknown[]) => void) {
			listeners[event] = [...(listeners[event] ?? []), cb];
		},
		// Trigger the events
		emit(event: string, ...args: unknown[]) {
			for (const cb of listeners[event] ?? []) cb(...args);
		},
		emitStdout(chunk: string) {
			for (const cb of stdoutListeners["data"] ?? []) cb(Buffer.from(chunk));
		},
		emitStderr(chunk: string) {
			for (const cb of stderrListeners["data"] ?? []) cb(Buffer.from(chunk));
		},
	};

	// Schedule emission after next tick
	Promise.resolve().then(() => {
		child.emitStdout(stdout);
		if (stderr) child.emitStderr(stderr);
		child.emit("close", exitCode);
	});

	return child;
}

// ---------------------------------------------------------------------------
// detectFramework tests
// ---------------------------------------------------------------------------

describe("TestRunner.detectFramework", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// By default, no files exist
		mockAccess.mockRejectedValue(new Error("ENOENT"));
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
	});

	it("detects vitest from package.json devDependencies", async () => {
		const pkg = JSON.stringify({ devDependencies: { vitest: "^1.0.0" } });
		mockReadFile.mockImplementation(async (p) => {
			if (p.endsWith("package.json")) return pkg;
			throw new Error("ENOENT");
		});

		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("vitest");
	});

	it("detects jest from package.json scripts", async () => {
		const pkg = JSON.stringify({ scripts: { test: "jest --ci" }, devDependencies: {} });
		mockReadFile.mockImplementation(async (p) => {
			if (p.endsWith("package.json")) return pkg;
			throw new Error("ENOENT");
		});

		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("jest");
	});

	it("detects vitest from vitest.config.ts file existence", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT")); // no package.json
		mockAccess.mockImplementation(async (p) => {
			if ((p as string).endsWith("vitest.config.ts")) return; // exists
			throw new Error("ENOENT");
		});

		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("vitest");
	});

	it("detects jest from jest.config.js file existence", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		mockAccess.mockImplementation(async (p) => {
			if ((p as string).endsWith("jest.config.js")) return;
			throw new Error("ENOENT");
		});

		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("jest");
	});

	it("detects pytest from pytest.ini existence", async () => {
		mockReadFile.mockImplementation(async (p) => {
			if ((p as string).endsWith("pyproject.toml")) return "[tool.pytest.ini_options]\npytest = true";
			throw new Error("ENOENT");
		});
		mockAccess.mockImplementation(async (p) => {
			if ((p as string).endsWith("pytest.ini")) return;
			throw new Error("ENOENT");
		});

		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("pytest");
	});

	it("returns unknown when no framework detected", async () => {
		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("unknown");
	});

	it("detects mocha from devDependencies", async () => {
		const pkg = JSON.stringify({ devDependencies: { mocha: "^10.0.0" } });
		mockReadFile.mockImplementation(async (p) => {
			if (p.endsWith("package.json")) return pkg;
			throw new Error("ENOENT");
		});

		const runner = makeRunner();
		const fw = await runner.detectFramework("/fake/repo");
		expect(fw).toBe("mocha");
	});
});

// ---------------------------------------------------------------------------
// parseTestOutput tests
// ---------------------------------------------------------------------------

describe("TestRunner.parseTestOutput", () => {
	const runner = makeRunner();

	it("parses vitest verbose summary line", () => {
		const output = `
 PASS  src/foo.test.ts
 Tests  5 passed | 1 failed | 2 skipped
`;
		const result = runner.parseTestOutput(output, "vitest");
		expect(result.passed).toBe(5);
		expect(result.failed).toBe(1);
		expect(result.skipped).toBe(2);
		expect(result.total).toBe(8);
	});

	it("parses jest summary line", () => {
		const output = `
Tests: 2 failed, 8 passed, 1 skipped, 11 total
`;
		const result = runner.parseTestOutput(output, "jest");
		expect(result.passed).toBe(8);
		expect(result.failed).toBe(2);
		expect(result.skipped).toBe(1);
		expect(result.total).toBe(11);
	});

	it("parses mocha output", () => {
		const output = `
  3 passing (200ms)
  1 failing
  2 pending
`;
		const result = runner.parseTestOutput(output, "mocha");
		expect(result.passed).toBe(3);
		expect(result.failed).toBe(1);
		expect(result.skipped).toBe(2);
		expect(result.total).toBe(6);
	});

	it("parses pytest output", () => {
		const output = "4 passed, 1 failed, 0 skipped in 1.23s";
		const result = runner.parseTestOutput(output, "pytest");
		expect(result.passed).toBe(4);
		expect(result.failed).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.total).toBe(5);
	});

	it("returns zero counts for empty output", () => {
		const result = runner.parseTestOutput("", "vitest");
		expect(result.passed).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.total).toBe(0);
	});

	it("extracts coverage percentage from vitest output", () => {
		const output = `
 Tests  10 passed
 All files  |  87.50 | Branch coverage
`;
		const result = runner.parseTestOutput(output, "vitest");
		expect(result.coverage).toBeCloseTo(87.5);
	});
});

// ---------------------------------------------------------------------------
// runTests structure validation
// We test runTests by mocking spawn to return a controllable child object.
// detectFramework is called first (async), then spawn is called.
// We use a deferred approach: resolve the result via mockSpawn's return value
// that fires its events when _fire() is called.
// ---------------------------------------------------------------------------

describe("TestRunner.runTests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAccess.mockRejectedValue(new Error("ENOENT"));
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
	});

	it("returns a TestRunResult with expected shape", async () => {
		const vitestOutput = " Tests  3 passed\n";

		// mockSpawn creates the child lazily so _fire() can be called after spawn
		let storedChild: ReturnType<typeof makeControllableChild> | null = null;

		function makeControllableChild(stdout: string) {
			const closeCbs: ((...a: unknown[]) => void)[] = [];
			const errorCbs: ((...a: unknown[]) => void)[] = [];
			const stdoutCbs: ((c: Buffer) => void)[] = [];
			const stderrCbs: ((c: Buffer) => void)[] = [];
			return {
				stdout: { on(_: string, cb: (c: Buffer) => void) { stdoutCbs.push(cb); } },
				stderr: { on(_: string, cb: (c: Buffer) => void) { stderrCbs.push(cb); } },
				on(ev: string, cb: (...a: unknown[]) => void) {
					if (ev === "close") closeCbs.push(cb);
					if (ev === "error") errorCbs.push(cb);
				},
				fireClose() {
					for (const cb of stdoutCbs) cb(Buffer.from(stdout));
					for (const cb of closeCbs) cb(0);
				},
				fireError(err: Error) {
					for (const cb of errorCbs) cb(err);
				},
			};
		}

		mockSpawn.mockImplementation(() => {
			storedChild = makeControllableChild(vitestOutput);
			return storedChild;
		});

		const runner = makeRunner();
		const runPromise = runner.runTests("proj-1", "/fake/repo");

		// Poll until spawn has been called (detectFramework completes first)
		await vi.waitFor(() => {
			expect(mockSpawn).toHaveBeenCalled();
		}, { timeout: 3000 });

		storedChild!.fireClose();

		const result = await runPromise;

		expect(result).toMatchObject({
			framework: expect.any(String),
			passed: expect.any(Number),
			failed: expect.any(Number),
			skipped: expect.any(Number),
			total: expect.any(Number),
			durationMs: expect.any(Number),
			rawOutput: expect.any(String),
		});
	}, 10_000);

	it("handles spawn error gracefully", async () => {
		let storedChild: { fireError: (e: Error) => void } | null = null;

		mockSpawn.mockImplementation(() => {
			const closeCbs: ((...a: unknown[]) => void)[] = [];
			const errorCbs: ((...a: unknown[]) => void)[] = [];
			storedChild = {
				fireError(err: Error) {
					for (const cb of errorCbs) cb(err);
				},
			};
			return {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on(ev: string, cb: (...a: unknown[]) => void) {
					if (ev === "close") closeCbs.push(cb);
					if (ev === "error") errorCbs.push(cb);
				},
			};
		});

		const runner = makeRunner();
		const runPromise = runner.runTests("proj-1", "/fake/repo");

		await vi.waitFor(() => {
			expect(mockSpawn).toHaveBeenCalled();
		}, { timeout: 3000 });

		storedChild!.fireError(new Error("spawn ENOENT"));

		const result = await runPromise;

		expect(result.error).toBeDefined();
		expect(result.passed).toBe(0);
		expect(result.failed).toBe(0);
	}, 10_000);
});
