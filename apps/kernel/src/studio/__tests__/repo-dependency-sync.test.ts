import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMissingHoistedDependencies, hoistPathForDeclaredPackage } from "../repo-dependency-sync.js";

describe("repo-dependency-sync", () => {
	it("resolves hoisted paths for scoped and unscoped packages", () => {
		const root = "/r";
		expect(hoistPathForDeclaredPackage(root, "react")).toBe(join(root, "node_modules", "react"));
		expect(hoistPathForDeclaredPackage(root, "@radix-ui/react-checkbox")).toBe(
			join(root, "node_modules", "@radix-ui", "react-checkbox"),
		);
	});

	it("reports missing packages when node_modules lacks hoisted entries", () => {
		const root = mkdtempSync(join(tmpdir(), "oscorpex-deps-"));
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				dependencies: { "lucide-react": "^0.4.0", "left-pad": "^1.0.0" },
			}),
		);
		mkdirSync(join(root, "node_modules"), { recursive: true });
		// partial install: lucide present, left-pad missing
		const lucideDir = hoistPathForDeclaredPackage(root, "lucide-react");
		mkdirSync(lucideDir, { recursive: true });
		writeFileSync(join(lucideDir, "package.json"), JSON.stringify({ name: "lucide-react" }));

		const missing = findMissingHoistedDependencies(root);
		expect(missing).toContain("left-pad");
		expect(missing).not.toContain("lucide-react");
	});
});
