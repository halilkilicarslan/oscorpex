// ---------------------------------------------------------------------------
// Orenda — Project Templates
// Pre-defined project scaffolding templates (Next.js, Express API, etc.)
// Creates initial file structure + package.json + config files in repo.
// ---------------------------------------------------------------------------

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  techStack: string[];
  teamTemplate: string; // team template name to use
  files: Record<string, string>; // relative path -> content
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'nextjs-app',
    name: 'Next.js App',
    description: 'Full-stack Next.js 15 with App Router, TypeScript, and Tailwind CSS',
    techStack: ['next', 'react', 'typescript', 'tailwindcss'],
    teamTemplate: 'Full Stack Team',
    files: {
      'package.json': JSON.stringify({
        name: 'my-nextjs-app',
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'next lint',
        },
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          typescript: '^5.7.0',
          '@types/node': '^22.0.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          tailwindcss: '^4.0.0',
          eslint: '^9.0.0',
          'eslint-config-next': '^15.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      }, null, 2),
      'next.config.ts': `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,
      'src/app/layout.tsx': `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My App",
  description: "Built with Orenda",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      'src/app/page.tsx': `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">Welcome to My App</h1>
      <p className="mt-4 text-lg text-gray-600">Built with Orenda</p>
    </main>
  );
}
`,
      'src/app/globals.css': `@import "tailwindcss";
`,
      '.gitignore': `node_modules/
.next/
out/
.env*.local
`,
    },
  },
  {
    id: 'express-api',
    name: 'Express API',
    description: 'REST API with Express, TypeScript, Prisma ORM, and JWT auth',
    techStack: ['express', 'typescript', 'prisma'],
    teamTemplate: 'Backend Team',
    files: {
      'package.json': JSON.stringify({
        name: 'my-express-api',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
          lint: 'eslint src/',
          'db:generate': 'prisma generate',
          'db:push': 'prisma db push',
        },
        dependencies: {
          express: '^5.0.0',
          '@prisma/client': '^6.0.0',
          cors: '^2.8.5',
          dotenv: '^16.4.0',
          jsonwebtoken: '^9.0.0',
          'zod': '^3.24.0',
        },
        devDependencies: {
          typescript: '^5.7.0',
          tsx: '^4.19.0',
          '@types/node': '^22.0.0',
          '@types/express': '^5.0.0',
          '@types/cors': '^2.8.0',
          '@types/jsonwebtoken': '^9.0.0',
          prisma: '^6.0.0',
          eslint: '^9.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: './dist',
          rootDir: './src',
        },
        include: ['src/**/*'],
      }, null, 2),
      'src/index.ts': `import express from 'express';
import cors from 'cors';
import { router } from './routes/index.js';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', router);

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});
`,
      'src/routes/index.ts': `import { Router } from 'express';

export const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'API is running' });
});
`,
      'prisma/schema.prisma': `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
      '.env': `DATABASE_URL="file:./dev.db"
JWT_SECRET="change-me-in-production"
PORT=3000
`,
      '.gitignore': `node_modules/
dist/
.env
prisma/dev.db
`,
    },
  },
  {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'React SPA with Vite, TypeScript, Tailwind CSS, and React Router',
    techStack: ['react', 'typescript', 'tailwindcss', 'vite'],
    teamTemplate: 'Frontend Team',
    files: {
      'package.json': JSON.stringify({
        name: 'my-react-app',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
          lint: 'eslint src/',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'react-router-dom': '^7.0.0',
        },
        devDependencies: {
          typescript: '^5.7.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          vite: '^6.0.0',
          '@vitejs/plugin-react': '^4.3.0',
          tailwindcss: '^4.0.0',
          eslint: '^9.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          jsx: 'react-jsx',
          skipLibCheck: true,
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      }, null, 2),
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
`,
      'src/App.tsx': `export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">My React App</h1>
        <p className="mt-4 text-lg text-gray-600">Built with Orenda</p>
      </div>
    </div>
  );
}
`,
      'src/index.css': `@import "tailwindcss";
`,
      '.gitignore': `node_modules/
dist/
.env.local
`,
    },
  },
  {
    id: 'hono-api',
    name: 'Hono API',
    description: 'Lightweight API with Hono, TypeScript, Drizzle ORM, and SQLite',
    techStack: ['hono', 'typescript', 'drizzle'],
    teamTemplate: 'Backend Team',
    files: {
      'package.json': JSON.stringify({
        name: 'my-hono-api',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
        },
        dependencies: {
          hono: '^4.7.0',
          '@hono/node-server': '^1.13.0',
          'drizzle-orm': '^0.38.0',
          'better-sqlite3': '^11.0.0',
        },
        devDependencies: {
          typescript: '^5.7.0',
          tsx: '^4.19.0',
          '@types/node': '^22.0.0',
          '@types/better-sqlite3': '^7.6.0',
          'drizzle-kit': '^0.30.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: './dist',
        },
        include: ['src/**/*'],
      }, null, 2),
      'src/index.ts': `import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors());

app.get('/', (c) => c.json({ message: 'Hono API running' }));
app.get('/health', (c) => c.json({ status: 'ok' }));

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(\`Server running on http://localhost:\${info.port}\`);
});
`,
      '.gitignore': `node_modules/
dist/
*.db
.env
`,
    },
  },
  {
    id: 'monorepo',
    name: 'pnpm Monorepo',
    description: 'Monorepo with pnpm workspaces: React frontend + Express API backend',
    techStack: ['react', 'express', 'typescript', 'pnpm'],
    teamTemplate: 'Full Stack Team',
    files: {
      'package.json': JSON.stringify({
        name: 'my-monorepo',
        private: true,
        scripts: {
          dev: 'pnpm -r dev',
          build: 'pnpm -r build',
          lint: 'pnpm -r lint',
        },
      }, null, 2),
      'pnpm-workspace.yaml': `packages:
  - "packages/*"
`,
      'packages/web/package.json': JSON.stringify({
        name: '@app/web',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.0', typescript: '^5.7.0' },
      }, null, 2),
      'packages/web/src/App.tsx': `export default function App() {
  return <h1>Frontend</h1>;
}
`,
      'packages/api/package.json': JSON.stringify({
        name: '@app/api',
        private: true,
        type: 'module',
        scripts: { dev: 'tsx watch src/index.ts', build: 'tsc' },
        dependencies: { express: '^5.0.0' },
        devDependencies: { typescript: '^5.7.0', tsx: '^4.19.0', '@types/express': '^5.0.0' },
      }, null, 2),
      'packages/api/src/index.ts': `import express from 'express';

const app = express();
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.listen(3001, () => console.log('API running on http://localhost:3001'));
`,
      '.gitignore': `node_modules/
dist/
.env
`,
    },
  },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function listProjectTemplates(): Omit<ProjectTemplate, 'files'>[] {
  return TEMPLATES.map(({ files: _f, ...rest }) => rest);
}

export function getProjectTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Scaffold a project from a template — writes all template files to repoPath.
 * Does NOT overwrite existing files.
 */
export async function scaffoldFromTemplate(
  repoPath: string,
  templateId: string,
): Promise<{ filesCreated: string[] }> {
  const template = getProjectTemplate(templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  const created: string[] = [];

  for (const [relPath, content] of Object.entries(template.files)) {
    const fullPath = join(repoPath, relPath);
    try {
      await mkdir(join(fullPath, '..'), { recursive: true });
      // Check if file exists — don't overwrite
      const { access } = await import('node:fs/promises');
      await access(fullPath);
      // File exists — skip
    } catch {
      // File doesn't exist — create it
      await writeFile(fullPath, content, 'utf-8');
      created.push(relPath);
    }
  }

  return { filesCreated: created };
}
