import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock child_process so isPortInUse (lsof) always returns "not in use"
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return {
    ...mod,
    execSync: vi.fn((cmd: string, opts?: unknown) => {
      if (typeof cmd === 'string' && cmd.startsWith('lsof -ti:')) {
        throw new Error('mock: port not in use');
      }
      return mod.execSync(cmd, opts as never);
    }),
  };
});

import { analyzeProject, writeEnvFile, generateStudioConfig } from '../runtime-analyzer.js';

describe('runtime-analyzer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runtime-analyzer-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Framework detection
  // ---------------------------------------------------------------------------
  describe('analyzeProject — framework detection', () => {
    it('should detect Express project', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-app',
        dependencies: { express: '^4.18.0' },
        scripts: { start: 'node server.js', dev: 'nodemon server.js' },
      }));
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.services.length).toBeGreaterThanOrEqual(1);
      const svc = result.services[0];
      expect(svc.framework).toBe('express');
      expect(svc.type).toBe('backend');
    });

    it('should detect Next.js project', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'next-app',
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
        scripts: { dev: 'next dev' },
      }));
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.services.length).toBeGreaterThanOrEqual(1);
      expect(result.services[0].framework).toBe('nextjs');
      expect(result.services[0].type).toBe('fullstack');
    });

    it('should detect Vite/React project', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'react-app',
        dependencies: { react: '^18.0.0' },
        devDependencies: { vite: '^5.0.0' },
        scripts: { dev: 'vite' },
      }));
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.services.length).toBeGreaterThanOrEqual(1);
      expect(result.services[0].framework).toBe('vite');
      expect(result.services[0].type).toBe('frontend');
    });

    it('should return empty for non-project directory', () => {
      const result = analyzeProject(tmpDir);
      expect(result.services).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Monorepo support
  // ---------------------------------------------------------------------------
  describe('analyzeProject — monorepo', () => {
    it('should detect services in apps/* (Turborepo)', () => {
      // Root package.json with workspaces
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'my-monorepo',
        private: true,
        workspaces: ['apps/*'],
      }));

      // apps/web — Vite frontend
      mkdirSync(join(tmpDir, 'apps', 'web', 'node_modules'), { recursive: true });
      writeFileSync(join(tmpDir, 'apps', 'web', 'package.json'), JSON.stringify({
        name: 'web',
        dependencies: { react: '^18.0.0' },
        devDependencies: { vite: '^5.0.0' },
        scripts: { dev: 'vite' },
      }));

      // apps/api — Express backend
      mkdirSync(join(tmpDir, 'apps', 'api', 'node_modules'), { recursive: true });
      writeFileSync(join(tmpDir, 'apps', 'api', 'package.json'), JSON.stringify({
        name: 'api',
        dependencies: { express: '^4.18.0' },
        scripts: { dev: 'nodemon index.js' },
      }));

      const result = analyzeProject(tmpDir);
      expect(result.services.length).toBeGreaterThanOrEqual(2);

      const web = result.services.find(s => s.name === 'web');
      const api = result.services.find(s => s.name === 'api');
      expect(web).toBeDefined();
      expect(web!.framework).toBe('vite');
      expect(web!.path).toBe('apps/web');
      expect(api).toBeDefined();
      expect(api!.framework).toBe('express');
      expect(api!.path).toBe('apps/api');
    });

    it('should detect services in packages/* (Lerna)', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'my-lerna-repo',
        private: true,
      }));

      // packages/server
      mkdirSync(join(tmpDir, 'packages', 'server', 'node_modules'), { recursive: true });
      writeFileSync(join(tmpDir, 'packages', 'server', 'package.json'), JSON.stringify({
        name: '@myapp/server',
        dependencies: { fastify: '^4.0.0' },
        scripts: { dev: 'tsx watch src/index.ts' },
      }));

      const result = analyzeProject(tmpDir);
      const server = result.services.find(s => s.path === 'packages/server');
      expect(server).toBeDefined();
      expect(server!.framework).toBe('fastify');
    });

    it('should combine known dirs and workspace packages', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'hybrid',
        private: true,
        workspaces: ['packages/*'],
      }));

      // backend/ — known dir
      mkdirSync(join(tmpDir, 'backend', 'node_modules'), { recursive: true });
      writeFileSync(join(tmpDir, 'backend', 'package.json'), JSON.stringify({
        name: 'backend',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));

      // packages/dashboard — workspace
      mkdirSync(join(tmpDir, 'packages', 'dashboard', 'node_modules'), { recursive: true });
      writeFileSync(join(tmpDir, 'packages', 'dashboard', 'package.json'), JSON.stringify({
        name: '@myapp/dashboard',
        dependencies: { react: '^18.0.0' },
        devDependencies: { vite: '^5.0.0' },
        scripts: { dev: 'vite' },
      }));

      const result = analyzeProject(tmpDir);
      expect(result.services.length).toBeGreaterThanOrEqual(2);
      expect(result.services.find(s => s.path === 'backend')).toBeDefined();
      expect(result.services.find(s => s.path === 'packages/dashboard')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Port detection (indirect via analyzeProject)
  // ---------------------------------------------------------------------------
  describe('analyzeProject — port detection', () => {
    it('should detect port from .env PORT', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      writeFileSync(join(tmpDir, '.env'), 'PORT=4567\nNODE_ENV=development');
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.services[0]?.port).toBe(4567);
    });

    it('should detect port from source code .listen()', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      writeFileSync(join(tmpDir, 'src', 'index.js'), `
const app = require('express')();
app.listen(8080, () => console.log('Server running'));
`);
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.services[0]?.port).toBe(8080);
    });

    it('should fallback to framework default port', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      // Express default is 3000
      expect(result.services[0]?.port).toBe(3000);
    });
  });

  // ---------------------------------------------------------------------------
  // Database detection (from .env.example and docker-compose)
  // ---------------------------------------------------------------------------
  describe('analyzeProject — database detection', () => {
    it('should detect PostgreSQL from .env.example', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      writeFileSync(join(tmpDir, '.env.example'), 'DATABASE_URL=postgresql://localhost:5432/mydb\nDB_HOST=localhost');
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.databases.length).toBeGreaterThanOrEqual(1);
      expect(result.databases[0].type).toBe('postgresql');
    });

    it('should detect MongoDB from .env.example', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      writeFileSync(join(tmpDir, '.env.example'), 'MONGO_URI=mongodb://localhost:27017/mydb');
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      const mongo = result.databases.find(d => d.type === 'mongodb');
      expect(mongo).toBeDefined();
    });

    it('should detect Redis from .env.example', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      writeFileSync(join(tmpDir, '.env.example'), 'REDIS_URL=redis://localhost:6379');
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      const redis = result.databases.find(d => d.type === 'redis');
      expect(redis).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Env file detection
  // ---------------------------------------------------------------------------
  describe('analyzeProject — env detection', () => {
    it('should detect env requirements from .env.example', () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        dependencies: { express: '^4.0.0' },
        scripts: { dev: 'node index.js' },
      }));
      writeFileSync(join(tmpDir, '.env.example'), `
DATABASE_URL=postgresql://localhost:5432/mydb
REDIS_URL=redis://localhost:6379
API_KEY=your-api-key-here
SECRET_KEY=change-me
PORT=3000
`);
      mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });

      const result = analyzeProject(tmpDir);
      expect(result.envVars.length).toBeGreaterThan(0);
      const dbUrl = result.envVars.find(e => e.key === 'DATABASE_URL');
      expect(dbUrl).toBeDefined();
      expect(dbUrl!.category).toBe('database');
    });
  });

  // ---------------------------------------------------------------------------
  // writeEnvFile — overwrites existing values and adds new ones
  // ---------------------------------------------------------------------------
  describe('writeEnvFile', () => {
    it('should create .env with provided vars', () => {
      writeEnvFile(tmpDir, { DB_HOST: 'localhost', DB_PORT: '5432' });

      const content = readFileSync(join(tmpDir, '.env'), 'utf-8');
      expect(content).toContain('DB_HOST=localhost');
      expect(content).toContain('DB_PORT=5432');
    });

    it('should merge with existing env file', () => {
      writeFileSync(join(tmpDir, '.env'), 'DB_HOST=remote-server\nNODE_ENV=production\n');
      writeEnvFile(tmpDir, { DB_HOST: 'localhost', DB_PORT: '5432' });

      const content = readFileSync(join(tmpDir, '.env'), 'utf-8');
      // writeEnvFile overwrites existing values
      expect(content).toContain('DB_HOST=localhost');
      // Existing non-conflicting values preserved
      expect(content).toContain('NODE_ENV=production');
      // New value added
      expect(content).toContain('DB_PORT=5432');
    });
  });

  // ---------------------------------------------------------------------------
  // generateStudioConfig
  // ---------------------------------------------------------------------------
  describe('generateStudioConfig', () => {
    it('should create .studio.json with services', () => {
      const services = [
        { name: 'api', path: '.', type: 'backend' as const, framework: 'express' as const, startCommand: 'node server.js', port: 3000, readyPattern: 'listening', depsInstalled: true },
        { name: 'web', path: 'frontend', type: 'frontend' as const, framework: 'vite' as const, startCommand: 'npm run dev', port: 5173, readyPattern: 'ready', depsInstalled: true },
      ];

      generateStudioConfig(tmpDir, services as any, 'web');

      const config = JSON.parse(readFileSync(join(tmpDir, '.studio.json'), 'utf-8'));
      expect(config.services).toHaveLength(2);
      expect(config.services[0].name).toBe('api');
      expect(config.services[0].port).toBe(3000);
      expect(config.preview).toBe('web');
    });

    it('should auto-select preview service', () => {
      const services = [
        { name: 'backend', path: '.', type: 'backend' as const, framework: 'express' as const, startCommand: 'node index.js', port: 3000, readyPattern: 'listening', depsInstalled: true },
      ];

      generateStudioConfig(tmpDir, services as any);

      const config = JSON.parse(readFileSync(join(tmpDir, '.studio.json'), 'utf-8'));
      expect(config.preview).toBe('backend');
    });
  });
});
