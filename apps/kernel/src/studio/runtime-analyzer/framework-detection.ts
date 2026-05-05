// ---------------------------------------------------------------------------
// Oscorpex — Runtime Analyzer — Framework & Port Detection
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FrameworkDetection, FrameworkType } from "./types.js";

// ---------------------------------------------------------------------------
// Port Detection — .env → kaynak kodu → framework default
// ---------------------------------------------------------------------------

const FRAMEWORK_DEFAULT_PORTS: Partial<Record<FrameworkType, number>> = {
	express: 3000,
	fastify: 3000,
	koa: 3000,
	hono: 3000,
	nestjs: 3000,
	nextjs: 3000,
	nuxt: 3000,
	vite: 5173,
	cra: 3000,
	angular: 4200,
	django: 8000,
	flask: 5000,
	fastapi: 8000,
	"spring-boot": 8080,
	gin: 8080,
	rails: 3000,
	"rust-actix": 8080,
};

export function detectPort(dirPath: string, framework: FrameworkType): number {
	// 1. .env dosyasından PORT oku
	const envPath = join(dirPath, ".env");
	if (existsSync(envPath)) {
		try {
			const envContent = readFileSync(envPath, "utf-8");
			const portMatch = envContent.match(/^PORT\s*=\s*(\d+)/m);
			if (portMatch) return Number.parseInt(portMatch[1]);
		} catch {
			/* ignore */
		}
	}

	// 2. Kaynak kodundan port parse et
	const sourceFiles = [
		"src/server.js",
		"src/index.js",
		"src/app.js",
		"server.js",
		"index.js",
		"app.js",
		"src/server.ts",
		"src/index.ts",
		"src/app.ts",
		"src/main.ts",
	];
	for (const file of sourceFiles) {
		const filePath = join(dirPath, file);
		if (!existsSync(filePath)) continue;
		try {
			const content = readFileSync(filePath, "utf-8");
			// .listen(3000), .listen(PORT || 3000), listen(process.env.PORT || 4000)
			const listenMatch = content.match(/\.listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{3,5})/);
			if (listenMatch) return Number.parseInt(listenMatch[1]);
			// const PORT = 3000 veya const port = 8080
			const constMatch = content.match(/(?:const|let|var)\s+[Pp][Oo][Rr][Tt]\s*=\s*(\d{3,5})/);
			if (constMatch) return Number.parseInt(constMatch[1]);
		} catch {
			/* ignore */
		}
	}

	// 3. Framework default
	return FRAMEWORK_DEFAULT_PORTS[framework] ?? 3000;
}

// ---------------------------------------------------------------------------
// Framework Detection
// ---------------------------------------------------------------------------

function detectNodeFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	if (!existsSync(join(dirPath, "package.json"))) return null;

	try {
		const pkg = JSON.parse(readFileSync(join(dirPath, "package.json"), "utf-8"));
		const deps = { ...pkg.dependencies, ...pkg.devDependencies };
		const usePnpm = existsSync(join(dirPath, "pnpm-lock.yaml"));
		const useYarn = existsSync(join(dirPath, "yarn.lock"));
		const pm = usePnpm ? "pnpm" : useYarn ? "yarn" : "npm";
		const exec = usePnpm ? "pnpm exec" : "npx";
		const depsInstalled = existsSync(join(dirPath, "node_modules"));
		const installCmd = `${pm} install`;

		// NestJS
		if (deps["@nestjs/core"]) {
			return {
				name: dirName,
				framework: "nestjs",
				language: "node",
				startCommand: pkg.scripts?.["start:dev"] ? `${pm} run start:dev` : `${exec} nest start --watch`,
				installCommand: installCmd,
				readyPattern: "listening|started|nest application",
				type: "backend",
				depsInstalled,
			};
		}
		// Next.js
		if (deps.next) {
			return {
				name: dirName,
				framework: "nextjs",
				language: "node",
				startCommand: `${exec} next dev --port \${PORT}`,
				installCommand: installCmd,
				readyPattern: "ready|compiled|started",
				type: "fullstack",
				depsInstalled,
			};
		}
		// Nuxt
		if (deps.nuxt) {
			return {
				name: dirName,
				framework: "nuxt",
				language: "node",
				startCommand: `${exec} nuxi dev --port \${PORT}`,
				installCommand: installCmd,
				readyPattern: "ready|listening|local",
				type: "fullstack",
				depsInstalled,
			};
		}
		// Vite
		if (deps.vite) {
			return {
				name: dirName,
				framework: "vite",
				language: "node",
				startCommand: `${exec} vite --port \${PORT}`,
				installCommand: installCmd,
				readyPattern: "ready|local|localhost",
				type: "frontend",
				depsInstalled,
			};
		}
		// CRA
		if (deps["react-scripts"]) {
			return {
				name: dirName,
				framework: "cra",
				language: "node",
				startCommand: `${exec} react-scripts start`,
				installCommand: installCmd,
				readyPattern: "compiled|webpack|ready",
				type: "frontend",
				depsInstalled,
			};
		}
		// Angular
		if (deps["@angular/core"]) {
			return {
				name: dirName,
				framework: "angular",
				language: "node",
				startCommand: `${exec} ng serve --port \${PORT}`,
				installCommand: installCmd,
				readyPattern: "compiled|listening|angular",
				type: "frontend",
				depsInstalled,
			};
		}
		// Express / Hono / Fastify / Koa
		const backendFramework = deps.express
			? ("express" as const)
			: deps.hono
				? ("hono" as const)
				: deps.fastify
					? ("fastify" as const)
					: deps.koa
						? ("koa" as const)
						: null;

		if (backendFramework) {
			const devScript = pkg.scripts?.dev;
			return {
				name: dirName,
				framework: backendFramework,
				language: "node",
				startCommand: devScript ? `${pm} run dev` : `${exec} tsx src/index.ts`,
				installCommand: installCmd,
				readyPattern: "listening|running|started|ready",
				type: "backend",
				depsInstalled,
			};
		}
		// Generic Node with dev script
		if (pkg.scripts?.dev || pkg.scripts?.start) {
			const cmd = pkg.scripts?.dev ? `${pm} run dev` : `${pm} run start`;
			return {
				name: dirName,
				framework: "generic-node",
				language: "node",
				startCommand: cmd,
				installCommand: installCmd,
				readyPattern: "listening|running|started|ready|compiled",
				type: "backend",
				depsInstalled,
			};
		}
	} catch {
		/* ignore */
	}

	return null;
}

function detectPythonFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	const hasPython =
		existsSync(join(dirPath, "requirements.txt")) ||
		existsSync(join(dirPath, "pyproject.toml")) ||
		existsSync(join(dirPath, "Pipfile"));

	if (!hasPython) return null;

	const usePipenv = existsSync(join(dirPath, "Pipfile"));
	const hasPyproject = existsSync(join(dirPath, "pyproject.toml"));
	const usePoetry = hasPyproject && readFileSync(join(dirPath, "pyproject.toml"), "utf-8").includes("[tool.poetry]");
	const useUv = existsSync(join(dirPath, "uv.lock"));
	const prefix = useUv ? "uv run" : usePoetry ? "poetry run" : usePipenv ? "pipenv run" : "python";
	const installCmd = useUv
		? "uv sync"
		: usePoetry
			? "poetry install"
			: usePipenv
				? "pipenv install"
				: "pip install -r requirements.txt";
	const venvExists = existsSync(join(dirPath, ".venv")) || existsSync(join(dirPath, "venv"));

	// Django
	if (existsSync(join(dirPath, "manage.py"))) {
		return {
			name: dirName,
			framework: "django",
			language: "python",
			startCommand: `${prefix} manage.py runserver 0.0.0.0:\${PORT}`,
			installCommand: installCmd,
			readyPattern: "starting development server|watching for file changes",
			type: "backend",
			depsInstalled: venvExists,
		};
	}
	// FastAPI
	if (existsSync(join(dirPath, "main.py")) || existsSync(join(dirPath, "app", "main.py"))) {
		const mainFile = existsSync(join(dirPath, "app", "main.py")) ? "app.main:app" : "main:app";
		return {
			name: dirName,
			framework: "fastapi",
			language: "python",
			startCommand: `${prefix} uvicorn ${mainFile} --host 0.0.0.0 --port \${PORT} --reload`,
			installCommand: installCmd,
			readyPattern: "uvicorn running|started server|application startup",
			type: "backend",
			depsInstalled: venvExists,
		};
	}
	// Flask
	if (existsSync(join(dirPath, "app.py")) || existsSync(join(dirPath, "wsgi.py"))) {
		return {
			name: dirName,
			framework: "flask",
			language: "python",
			startCommand: `${prefix} flask run --host 0.0.0.0 --port \${PORT}`,
			installCommand: installCmd,
			readyPattern: "running on|debugger is active",
			type: "backend",
			depsInstalled: venvExists,
		};
	}
	// Generic Python
	return {
		name: dirName,
		framework: "generic-python",
		language: "python",
		startCommand: `${prefix} main.py`,
		installCommand: installCmd,
		readyPattern: "running|started|listening",
		type: "backend",
		depsInstalled: venvExists,
	};
}

function detectJavaFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	// Maven
	if (existsSync(join(dirPath, "pom.xml"))) {
		const wrapper = existsSync(join(dirPath, "mvnw")) ? "./mvnw" : "mvn";
		return {
			name: dirName,
			framework: "spring-boot",
			language: "java",
			startCommand: `${wrapper} spring-boot:run -Dspring-boot.run.arguments=--server.port=\${PORT}`,
			installCommand: `${wrapper} clean install -DskipTests`,
			readyPattern: "started|tomcat started|netty started|listening",
			type: "backend",
			depsInstalled: existsSync(join(dirPath, "target")),
		};
	}

	// Gradle
	if (existsSync(join(dirPath, "build.gradle")) || existsSync(join(dirPath, "build.gradle.kts"))) {
		const wrapper = existsSync(join(dirPath, "gradlew")) ? "./gradlew" : "gradle";
		return {
			name: dirName,
			framework: "spring-boot",
			language: "java",
			startCommand: `${wrapper} bootRun --args='--server.port=\${PORT}'`,
			installCommand: `${wrapper} build -x test`,
			readyPattern: "started|tomcat started|netty started|listening",
			type: "backend",
			depsInstalled: existsSync(join(dirPath, "build")),
		};
	}

	return null;
}

function detectGoFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	if (!existsSync(join(dirPath, "go.mod"))) return null;

	const framework =
		existsSync(join(dirPath, "go.sum")) &&
		readFileSync(join(dirPath, "go.sum"), "utf-8").includes("github.com/gin-gonic/gin")
			? ("gin" as const)
			: ("go" as const);

	return {
		name: dirName,
		framework,
		language: "go",
		startCommand: "go run .",
		installCommand: "go mod download",
		readyPattern: "listening|started|running|serving",
		type: "backend",
		depsInstalled: true, // Go modules auto-download
	};
}

function detectRubyFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	if (!existsSync(join(dirPath, "Gemfile"))) return null;

	const isRails = existsSync(join(dirPath, "config", "routes.rb"));
	return {
		name: dirName,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		framework: isRails ? ("rails" as any) : "unknown",
		language: "ruby",
		startCommand: isRails ? "bundle exec rails server -p ${PORT}" : "bundle exec ruby app.rb",
		installCommand: "bundle install",
		readyPattern: "listening|puma starting|rails.*started",
		type: "backend",
		depsInstalled: existsSync(join(dirPath, "vendor", "bundle")),
	};
}

function detectRustFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	if (!existsSync(join(dirPath, "Cargo.toml"))) return null;

	return {
		name: dirName,
		framework: "rust-actix",
		language: "rust",
		startCommand: "cargo run",
		installCommand: "cargo build",
		readyPattern: "listening|started|running|serving",
		type: "backend",
		depsInstalled: existsSync(join(dirPath, "target")),
	};
}

export function detectFramework(dirPath: string, dirName: string): FrameworkDetection | null {
	return (
		detectNodeFramework(dirPath, dirName) ??
		detectPythonFramework(dirPath, dirName) ??
		detectJavaFramework(dirPath, dirName) ??
		detectGoFramework(dirPath, dirName) ??
		detectRubyFramework(dirPath, dirName) ??
		detectRustFramework(dirPath, dirName)
	);
}
