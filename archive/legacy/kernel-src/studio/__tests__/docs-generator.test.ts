import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDocsFreshness } from "../docs-generator.js";

describe("docs-generator", () => {
	let tmpDir: string;
	let docsDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "docs-test-"));
		docsDir = join(tmpDir, "docs");
		mkdirSync(docsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("checkDocsFreshness", () => {
		it("should report missing docs", async () => {
			const results = await checkDocsFreshness(tmpDir);
			// All 6 docs should be missing since we didn't create them
			expect(results.every((r) => r.status === "missing")).toBe(true);
			expect(results.length).toBe(6);
		});

		it("should report TBD docs", async () => {
			writeFileSync(join(docsDir, "PROJECT.md"), "# Project\n\nTBD\n", "utf-8");
			writeFileSync(join(docsDir, "ARCHITECTURE.md"), "# Architecture\n\nTBD\n", "utf-8");
			writeFileSync(join(docsDir, "API_CONTRACT.md"), "# API Contract\n\nTBD\n", "utf-8");

			const results = await checkDocsFreshness(tmpDir);
			const project = results.find((r) => r.file === "PROJECT.md");
			const arch = results.find((r) => r.file === "ARCHITECTURE.md");

			expect(project?.status).toBe("tbd");
			expect(arch?.status).toBe("tbd");
		});

		it("should report filled docs", async () => {
			const longContent = `# Project\n\n## Overview\n\nThis is a real project with real content that is longer than 100 chars so it won't be marked as TBD anymore.\n\n## Tech Stack\n\nTypeScript, React\n`;
			writeFileSync(join(docsDir, "PROJECT.md"), longContent, "utf-8");

			const results = await checkDocsFreshness(tmpDir);
			const project = results.find((r) => r.file === "PROJECT.md");
			expect(project?.status).toBe("filled");
		});

		it("should handle mixed states", async () => {
			writeFileSync(join(docsDir, "PROJECT.md"), "# Project\n\nTBD\n", "utf-8");
			const filled =
				"# Changelog\n\nAll notable changes to this project.\n\n- 2026-04-08 — Setup project — 5 files\n" +
				"Extra content to exceed 100 chars threshold for non-TBD detection in the freshness checker.\n";
			writeFileSync(join(docsDir, "CHANGELOG.md"), filled, "utf-8");
			// ARCHITECTURE.md is missing

			const results = await checkDocsFreshness(tmpDir);
			expect(results.find((r) => r.file === "PROJECT.md")?.status).toBe("tbd");
			expect(results.find((r) => r.file === "CHANGELOG.md")?.status).toBe("filled");
			expect(results.find((r) => r.file === "ARCHITECTURE.md")?.status).toBe("missing");
		});
	});
});
