import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { afterAll } from 'vitest';
import { resetDb } from '../db.js';

// Each test run gets a unique temp DB file
const tempDir = mkdtempSync(join(tmpdir(), 'studio-test-'));
const testDbPath = join(tempDir, 'test.db');

process.env.STUDIO_DB_PATH = testDbPath;

afterAll(() => {
  resetDb();
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});
