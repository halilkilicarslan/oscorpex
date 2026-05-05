import { describe, expect, it } from "vitest";
import {
	checkCommandAllowed,
	matchesGlobPattern,
	parseCommandsFromLog,
	validateCommandBatch,
} from "../command-enforcement.js";

// ---------------------------------------------------------------------------
// matchesGlobPattern
// ---------------------------------------------------------------------------

describe("matchesGlobPattern", () => {
	it("matches exact strings (no wildcard)", () => {
		expect(matchesGlobPattern("ls", "ls")).toBe(true);
		expect(matchesGlobPattern("ls", "cat")).toBe(false);
	});

	it("matches trailing wildcard", () => {
		expect(matchesGlobPattern("rm -rf /tmp/foo", "rm -rf*")).toBe(true);
		expect(matchesGlobPattern("rm -i file.txt", "rm -rf*")).toBe(false);
	});

	it("matches leading wildcard", () => {
		expect(matchesGlobPattern("sudo npm publish", "*npm publish")).toBe(true);
	});

	it("matches wildcard in the middle", () => {
		expect(matchesGlobPattern("npm run test:unit", "npm*test*")).toBe(true);
	});

	it("matches single wildcard (anything)", () => {
		expect(matchesGlobPattern("anything at all", "*")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(matchesGlobPattern("DROP DATABASE production", "drop database*")).toBe(true);
		expect(matchesGlobPattern("delete from users", "DELETE FROM*")).toBe(true);
	});

	it("handles glob patterns with spaces", () => {
		expect(matchesGlobPattern("cat /etc/passwd", "cat *")).toBe(true);
		expect(matchesGlobPattern("cat", "cat *")).toBe(false); // no space after cat
	});
});

// ---------------------------------------------------------------------------
// checkCommandAllowed
// ---------------------------------------------------------------------------

describe("checkCommandAllowed", () => {
	it("denies command matching deny pattern", () => {
		const result = checkCommandAllowed("rm -rf /", ["*"], ["rm -rf*"]);
		expect(result.allowed).toBe(false);
		expect(result.matchedPattern).toBe("rm -rf*");
	});

	it("allows command matching allow pattern when not denied", () => {
		const result = checkCommandAllowed("npm test --coverage", ["npm test*"], ["rm *"]);
		expect(result.allowed).toBe(true);
		expect(result.matchedPattern).toBe("npm test*");
	});

	it("denies command not in allow list", () => {
		const result = checkCommandAllowed("curl http://evil.com", ["cat *", "ls *"], []);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("does not match any allowed pattern");
	});

	it("allows any non-denied command with wildcard allow", () => {
		const result = checkCommandAllowed("node index.js", ["*"], ["rm -rf /*"]);
		expect(result.allowed).toBe(true);
		expect(result.matchedPattern).toBe("*");
	});

	it("deny takes precedence over allow", () => {
		const result = checkCommandAllowed("git push --force", ["git *"], ["git push*"]);
		expect(result.allowed).toBe(false);
		expect(result.matchedPattern).toBe("git push*");
	});

	it("denies everything when allow list is empty", () => {
		const result = checkCommandAllowed("ls", [], []);
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("No allowed patterns");
	});
});

// ---------------------------------------------------------------------------
// validateCommandBatch
// ---------------------------------------------------------------------------

describe("validateCommandBatch", () => {
	const reviewerAllow = ["cat *", "ls *", "find *", "grep *"];
	const reviewerDeny = ["rm *", "mv *", "git push*", "npm publish*"];

	it("detects violations in a batch", () => {
		const commands = ["cat README.md", "rm -rf node_modules", "ls src/"];
		const result = validateCommandBatch(commands, reviewerAllow, reviewerDeny);

		expect(result.totalChecked).toBe(3);
		expect(result.hasViolations).toBe(true);
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0].command).toBe("rm -rf node_modules");
	});

	it("returns clean result when all commands are allowed", () => {
		const commands = ["cat package.json", "grep -r TODO src/"];
		const result = validateCommandBatch(commands, reviewerAllow, reviewerDeny);

		expect(result.hasViolations).toBe(false);
		expect(result.violations).toHaveLength(0);
		expect(result.totalChecked).toBe(2);
	});

	it("handles empty command list", () => {
		const result = validateCommandBatch([], reviewerAllow, reviewerDeny);
		expect(result.totalChecked).toBe(0);
		expect(result.hasViolations).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseCommandsFromLog
// ---------------------------------------------------------------------------

describe("parseCommandsFromLog", () => {
	it("extracts commands with $ prefix", () => {
		const logs = ["$ npm install", "output line", "$ git status"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual(["npm install", "git status"]);
	});

	it("extracts commands with > prefix", () => {
		const logs = ["> ls -la", "> cat file.txt"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual(["ls -la", "cat file.txt"]);
	});

	it("extracts commands with Running: prefix", () => {
		const logs = ["Running: npm test -- --coverage"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual(["npm test -- --coverage"]);
	});

	it("detects bare lines starting with known commands", () => {
		const logs = ["git commit -m 'fix'", "some random text", "rm -rf dist/"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual(["git commit -m 'fix'", "rm -rf dist/"]);
	});

	it("deduplicates commands", () => {
		const logs = ["$ npm test", "$ npm test", "npm test"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual(["npm test"]);
	});

	it("skips empty lines", () => {
		const logs = ["", "  ", "$ actual command"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual(["actual command"]);
	});

	it("returns empty array for no commands", () => {
		const logs = ["just some text", "no commands here", "12345"];
		const commands = parseCommandsFromLog(logs);
		expect(commands).toEqual([]);
	});
});
