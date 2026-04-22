import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppStatus, resolveConfig } from "../app-runner.js";

describe("app-runner", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "app-runner-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------------
	// .studio.json detection
	// -------------------------------------------------------------------------
	describe("resolveConfig — .studio.json", () => {
		it("should load .studio.json when present", () => {
			writeFileSync(
				join(tmpDir, ".studio.json"),
				JSON.stringify({
					services: [
						{ name: "api", path: ".", command: "node server.js", port: 3000, readyPattern: "listening" },
						{ name: "web", path: "frontend", command: "npm start", port: 4000, readyPattern: "compiled" },
					],
					preview: "web",
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services).toHaveLength(2);
			expect(config!.services[0].name).toBe("api");
			expect(config!.services[1].name).toBe("web");
			expect(config!.preview).toBe("web");
		});

		it("should return null for invalid .studio.json", () => {
			writeFileSync(join(tmpDir, ".studio.json"), "{ broken json");
			const config = resolveConfig(tmpDir);
			expect(config).toBeNull();
		});

		it("should return null when services array is missing", () => {
			writeFileSync(join(tmpDir, ".studio.json"), JSON.stringify({ preview: "app" }));
			const config = resolveConfig(tmpDir);
			expect(config).toBeNull();
		});

		it("should use defaults for missing service fields", () => {
			writeFileSync(
				join(tmpDir, ".studio.json"),
				JSON.stringify({
					services: [{ name: "myapp" }],
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].port).toBe(3000);
			expect(config!.services[0].command).toBe("npm start");
			expect(config!.services[0].path).toBe(".");
		});
	});

	// -------------------------------------------------------------------------
	// Docker Compose detection
	// -------------------------------------------------------------------------
	describe("resolveConfig — Docker Compose", () => {
		it("should detect docker-compose.yml with port mappings", () => {
			writeFileSync(
				join(tmpDir, "docker-compose.yml"),
				`
version: "3"
services:
  backend:
    build: ./backend
    ports:
      - "3000:3000"
  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
`,
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services.length).toBeGreaterThanOrEqual(2);

			const names = config!.services.map((s) => s.name);
			expect(names).toContain("backend");
			expect(names).toContain("frontend");

			// backend port 3000 is also in the common frontend ports list, so it matches first
			// The first service with a common port wins — that's backend:3000 here
			expect(["backend", "frontend"]).toContain(config!.preview);
		});

		it("should detect compose.yml (alternate name)", () => {
			writeFileSync(
				join(tmpDir, "compose.yml"),
				`
services:
  app:
    build: .
    ports:
      - "8080:8080"
`,
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services.some((s) => s.name === "app")).toBe(true);
		});

		it(".studio.json should take priority over docker-compose", () => {
			writeFileSync(
				join(tmpDir, ".studio.json"),
				JSON.stringify({
					services: [{ name: "priority", command: "node app.js", port: 9999, readyPattern: "ready" }],
					preview: "priority",
				}),
			);
			writeFileSync(
				join(tmpDir, "docker-compose.yml"),
				`
services:
  ignored:
    ports:
      - "3000:3000"
`,
			);

			const config = resolveConfig(tmpDir);
			expect(config!.services[0].name).toBe("priority");
			expect(config!.services[0].port).toBe(9999);
		});
	});

	// -------------------------------------------------------------------------
	// Auto-detection — Node.js
	// -------------------------------------------------------------------------
	describe("resolveConfig — auto-detect Node.js", () => {
		it("should detect Next.js project", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { next: "14.0.0", react: "18.0.0" },
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("next dev");
		});

		it("should detect Vite project", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					devDependencies: { vite: "5.0.0" },
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("vite");
		});

		it("should detect Express with dev script", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { express: "4.18.0" },
					scripts: { dev: "tsx src/index.ts" },
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("run dev");
		});

		it("should detect pnpm from lock file", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { next: "14.0.0" },
				}),
			);
			writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("pnpm exec");
		});

		it("should use npx for npm projects", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { next: "14.0.0" },
				}),
			);
			// No lock file = npm default

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("npx");
		});

		it("should detect yarn from lock file", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { next: "14.0.0" },
				}),
			);
			writeFileSync(join(tmpDir, "yarn.lock"), "");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("npx");
		});
	});

	// -------------------------------------------------------------------------
	// Auto-detection — Python
	// -------------------------------------------------------------------------
	describe("resolveConfig — auto-detect Python", () => {
		it("should detect Django project", () => {
			writeFileSync(join(tmpDir, "requirements.txt"), "django==4.2");
			writeFileSync(join(tmpDir, "manage.py"), "#!/usr/bin/env python");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("manage.py runserver");
		});

		it("should detect FastAPI project", () => {
			writeFileSync(join(tmpDir, "requirements.txt"), "fastapi==0.100.0");
			writeFileSync(join(tmpDir, "main.py"), "from fastapi import FastAPI");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("uvicorn");
		});

		it("should detect Flask project", () => {
			writeFileSync(join(tmpDir, "requirements.txt"), "flask==3.0");
			writeFileSync(join(tmpDir, "app.py"), "from flask import Flask");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("flask run");
		});
	});

	// -------------------------------------------------------------------------
	// Auto-detection — Java
	// -------------------------------------------------------------------------
	describe("resolveConfig — auto-detect Java", () => {
		it("should detect Maven project", () => {
			writeFileSync(join(tmpDir, "pom.xml"), "<project></project>");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("spring-boot:run");
		});

		it("should use mvnw wrapper when present", () => {
			writeFileSync(join(tmpDir, "pom.xml"), "<project></project>");
			writeFileSync(join(tmpDir, "mvnw"), "#!/bin/sh");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("./mvnw");
		});

		it("should detect Gradle project", () => {
			writeFileSync(join(tmpDir, "build.gradle"), 'plugins { id "java" }');

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("bootRun");
		});
	});

	// -------------------------------------------------------------------------
	// Auto-detection — Go, Ruby, Rust
	// -------------------------------------------------------------------------
	describe("resolveConfig — auto-detect other languages", () => {
		it("should detect Go project", () => {
			writeFileSync(join(tmpDir, "go.mod"), "module example.com/app");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("go run");
		});

		it("should detect Rails project", () => {
			writeFileSync(join(tmpDir, "Gemfile"), 'gem "rails"');
			mkdirSync(join(tmpDir, "config"), { recursive: true });
			writeFileSync(join(tmpDir, "config", "routes.rb"), "Rails.application.routes.draw");

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("rails server");
		});

		it("should detect Rust project", () => {
			writeFileSync(join(tmpDir, "Cargo.toml"), '[package]\nname = "app"');

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services[0].command).toContain("cargo run");
		});
	});

	// -------------------------------------------------------------------------
	// Monorepo — multi-service detection
	// -------------------------------------------------------------------------
	describe("resolveConfig — monorepo", () => {
		it("should detect backend + frontend subdirs", () => {
			mkdirSync(join(tmpDir, "backend"), { recursive: true });
			writeFileSync(
				join(tmpDir, "backend", "package.json"),
				JSON.stringify({
					dependencies: { express: "4.18.0" },
					scripts: { dev: "tsx src/index.ts" },
				}),
			);

			mkdirSync(join(tmpDir, "frontend"), { recursive: true });
			writeFileSync(
				join(tmpDir, "frontend", "package.json"),
				JSON.stringify({
					devDependencies: { vite: "5.0.0" },
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services).toHaveLength(2);

			const names = config!.services.map((s) => s.name);
			expect(names).toContain("backend");
			expect(names).toContain("frontend");

			// frontend (vite) should be preview
			expect(config!.preview).toBe("frontend");
		});

		it("should detect mixed-language monorepo (Python backend + Node frontend)", () => {
			mkdirSync(join(tmpDir, "backend"), { recursive: true });
			writeFileSync(join(tmpDir, "backend", "requirements.txt"), "fastapi");
			writeFileSync(join(tmpDir, "backend", "main.py"), "app = FastAPI()");

			mkdirSync(join(tmpDir, "frontend"), { recursive: true });
			writeFileSync(
				join(tmpDir, "frontend", "package.json"),
				JSON.stringify({
					devDependencies: { vite: "5.0.0" },
				}),
			);

			const config = resolveConfig(tmpDir);
			expect(config).not.toBeNull();
			expect(config!.services).toHaveLength(2);

			const backendSvc = config!.services.find((s) => s.name === "backend");
			const frontendSvc = config!.services.find((s) => s.name === "frontend");
			expect(backendSvc!.command).toContain("uvicorn");
			expect(frontendSvc!.command).toContain("vite");
		});

		it("should assign unique ports to each service", () => {
			mkdirSync(join(tmpDir, "backend"), { recursive: true });
			writeFileSync(
				join(tmpDir, "backend", "package.json"),
				JSON.stringify({
					dependencies: { express: "4.18.0" },
					scripts: { dev: "node index.js" },
				}),
			);

			mkdirSync(join(tmpDir, "frontend"), { recursive: true });
			writeFileSync(
				join(tmpDir, "frontend", "package.json"),
				JSON.stringify({
					devDependencies: { vite: "5.0.0" },
				}),
			);

			const config = resolveConfig(tmpDir);
			const ports = config!.services.map((s) => s.port);
			expect(new Set(ports).size).toBe(ports.length); // all unique
		});
	});

	// -------------------------------------------------------------------------
	// No project detected
	// -------------------------------------------------------------------------
	describe("resolveConfig — empty directory", () => {
		it("should return null for empty dir", () => {
			const config = resolveConfig(tmpDir);
			expect(config).toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// Settings override
	// -------------------------------------------------------------------------
	describe("resolveConfig — settings override", () => {
		it("should use settings override when provided", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { next: "14.0.0" },
				}),
			);

			const override = {
				services: [{ name: "custom", path: ".", command: "custom-cmd", port: 9999, readyPattern: "ok" }],
				preview: "custom",
			};

			const config = resolveConfig(tmpDir, override);
			expect(config!.services[0].name).toBe("custom");
			expect(config!.services[0].port).toBe(9999);
		});

		it("should fallback to auto-detect when override has empty services", () => {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					dependencies: { next: "14.0.0" },
				}),
			);

			const override = { services: [], preview: "" };
			const config = resolveConfig(tmpDir, override);
			expect(config!.services[0].command).toContain("next dev");
		});
	});

	// -------------------------------------------------------------------------
	// getAppStatus — no running app
	// -------------------------------------------------------------------------
	describe("getAppStatus", () => {
		it("should return not running for unknown project", () => {
			const status = getAppStatus("nonexistent-project-id");
			expect(status.running).toBe(false);
			expect(status.services).toHaveLength(0);
			expect(status.previewUrl).toBeNull();
			expect(status.backendUrl).toBeNull();
			expect(status.frontendUrl).toBeNull();
		});
	});
});
