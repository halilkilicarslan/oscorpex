import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDeclaredDependencies } from "../dependency-verifier.js";

const tempDirs: string[] = [];

function createTempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "oscorpex-deps-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("dependency verifier", () => {
	it("passes when external imports are declared", () => {
		const repo = createTempRepo();
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify({ dependencies: { react: "^19.0.0", "lucide-react": "^0.0.0" } }),
		);
		mkdirSync(join(repo, "src", "components"), { recursive: true });
		writeFileSync(
			join(repo, "src", "components", "todo-item.tsx"),
			`import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
export const TodoItem = () => <Button><Trash2 /></Button>;
`,
		);

		const result = verifyDeclaredDependencies(repo, {
			filesCreated: ["src/components/todo-item.tsx"],
			filesModified: [],
			logs: [],
		});

		expect(result.passed).toBe(true);
		expect(result.missingDependencies).toEqual([]);
	});

	it("fails when touched files import undeclared external packages", () => {
		const repo = createTempRepo();
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify({ dependencies: { react: "^19.0.0" } }),
		);
		mkdirSync(join(repo, "src", "components"), { recursive: true });
		writeFileSync(
			join(repo, "src", "components", "todo-item.tsx"),
			`import React from "react";
import { Trash2 } from "lucide-react";
export const TodoItem = () => <Trash2 />;
`,
		);

		const result = verifyDeclaredDependencies(repo, {
			filesCreated: [],
			filesModified: ["src/components/todo-item.tsx"],
			logs: [],
		});

		expect(result.passed).toBe(false);
		expect(result.missingDependencies).toEqual(["lucide-react"]);
		expect(result.checkedFiles).toEqual(["src/components/todo-item.tsx"]);
	});
});
