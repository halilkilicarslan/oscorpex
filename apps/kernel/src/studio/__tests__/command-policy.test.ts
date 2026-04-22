import { describe, expect, it } from "vitest";
import { buildPolicyPromptSection, getDefaultPolicy } from "../command-policy.js";

describe("getDefaultPolicy", () => {
	it("reviewer rolü için salt-okunur politika döndürür", () => {
		const policy = getDefaultPolicy("reviewer");
		expect(policy.role).toBe("reviewer");
		expect(policy.fileWriteAllowed).toBe(false);
		expect(policy.destructiveAllowed).toBe(false);
		expect(policy.allowedPatterns).toContain("cat *");
		expect(policy.allowedPatterns).toContain("grep *");
		expect(policy.deniedPatterns).toContain("rm *");
		expect(policy.deniedPatterns).toContain("git push*");
		expect(policy.deniedPatterns).toContain("git commit*");
	});

	it("frontend-reviewer rolü için de salt-okunur politika döndürür", () => {
		const policy = getDefaultPolicy("frontend-reviewer");
		expect(policy.fileWriteAllowed).toBe(false);
		expect(policy.destructiveAllowed).toBe(false);
		expect(policy.deniedPatterns).toContain("rm *");
	});

	it("backend-reviewer rolü için de salt-okunur politika döndürür", () => {
		const policy = getDefaultPolicy("backend-reviewer");
		expect(policy.fileWriteAllowed).toBe(false);
		expect(policy.destructiveAllowed).toBe(false);
	});

	it("qa rolü test komutlarına izin verir ama yıkıcı komutları yasaklar", () => {
		const policy = getDefaultPolicy("qa");
		expect(policy.role).toBe("qa");
		expect(policy.fileWriteAllowed).toBe(true);
		expect(policy.destructiveAllowed).toBe(false);
		expect(policy.allowedPatterns).toContain("pnpm test*");
		expect(policy.allowedPatterns).toContain("vitest*");
		expect(policy.allowedPatterns).toContain("jest*");
		expect(policy.deniedPatterns).toContain("rm -rf*");
		expect(policy.deniedPatterns).toContain("git push*");
		expect(policy.deniedPatterns).toContain("DROP *");
		expect(policy.deniedPatterns).toContain("DELETE FROM*");
	});

	it("product-owner rolü için gözlemci politikası döndürür", () => {
		const policy = getDefaultPolicy("product-owner");
		expect(policy.fileWriteAllowed).toBe(false);
		expect(policy.destructiveAllowed).toBe(false);
		expect(policy.allowedPatterns).toContain("ls *");
		expect(policy.deniedPatterns).toContain("git *");
		expect(policy.deniedPatterns).toContain("npm *");
	});

	it("designer rolü için gözlemci politikası döndürür", () => {
		const policy = getDefaultPolicy("designer");
		expect(policy.fileWriteAllowed).toBe(false);
		expect(policy.deniedPatterns).toContain("pnpm *");
	});

	it("architect rolü için teknik politika döndürür (yazma var, silme yok)", () => {
		const policy = getDefaultPolicy("architect");
		expect(policy.fileWriteAllowed).toBe(true);
		expect(policy.destructiveAllowed).toBe(false);
		expect(policy.allowedPatterns).toContain("tree *");
		expect(policy.deniedPatterns).toContain("rm -rf*");
		expect(policy.deniedPatterns).toContain("git push*");
	});

	it("tech-writer rolü için teknik politika döndürür", () => {
		const policy = getDefaultPolicy("tech-writer");
		expect(policy.fileWriteAllowed).toBe(true);
		expect(policy.destructiveAllowed).toBe(false);
	});

	it("frontend-dev gibi tanımsız rol için kısıtlamasız geliştirici politikası döndürür", () => {
		const policy = getDefaultPolicy("frontend-dev");
		expect(policy.role).toBe("frontend-dev");
		expect(policy.fileWriteAllowed).toBe(true);
		expect(policy.destructiveAllowed).toBe(false);
		expect(policy.allowedPatterns).toContain("*");
		expect(policy.deniedPatterns).toContain("rm -rf /*");
		expect(policy.deniedPatterns).toContain("DROP DATABASE*");
		expect(policy.deniedPatterns).toContain("npm publish*");
	});

	it("backend-dev gibi tanımsız rol için de geliştirici politikası döndürür", () => {
		const policy = getDefaultPolicy("backend-dev");
		expect(policy.allowedPatterns).toContain("*");
	});
});

describe("buildPolicyPromptSection", () => {
	it("markdown bölümünü tüm alanlarla birlikte üretir", () => {
		const policy = getDefaultPolicy("reviewer");
		const section = buildPolicyPromptSection(policy);

		expect(section).toContain("## Security Policy");
		expect(section).toContain("Allowed commands:");
		expect(section).toContain("Denied commands:");
		expect(section).toContain("File write access: No");
		expect(section).toContain("Destructive operations: Not allowed");
		expect(section).toContain("IMPORTANT: Do not execute denied commands");
	});

	it("izin verilen ve yasaklanan kalıpları satır satır listeler", () => {
		const policy = getDefaultPolicy("reviewer");
		const section = buildPolicyPromptSection(policy);

		expect(section).toContain("`cat *`");
		expect(section).toContain("`grep *`");
		expect(section).toContain("`rm *`");
		expect(section).toContain("`git push*`");
	});

	it('dosya yazma izni varken "Yes" gösterir', () => {
		const policy = getDefaultPolicy("qa");
		const section = buildPolicyPromptSection(policy);
		expect(section).toContain("File write access: Yes");
	});

	it("geliştirici rolü için kısıtlamasız allowedPatterns gösterir", () => {
		const policy = getDefaultPolicy("fullstack-dev");
		const section = buildPolicyPromptSection(policy);
		expect(section).toContain("`*`");
	});
});
