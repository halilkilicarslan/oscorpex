import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { initLintConfig } from '../lint-runner.js';

describe('lint-runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lint-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initLintConfig', () => {
    it('should create eslint.config.mjs and .prettierrc when missing', async () => {
      await initLintConfig(tmpDir);

      expect(existsSync(join(tmpDir, 'eslint.config.mjs'))).toBe(true);
      expect(existsSync(join(tmpDir, '.prettierrc'))).toBe(true);

      const prettierContent = readFileSync(join(tmpDir, '.prettierrc'), 'utf-8');
      const parsed = JSON.parse(prettierContent);
      expect(parsed.semi).toBe(true);
      expect(parsed.singleQuote).toBe(true);
    });

    it('should not overwrite existing eslint config', async () => {
      const existingConfig = '// custom eslint config';
      writeFileSync(join(tmpDir, 'eslint.config.mjs'), existingConfig, 'utf-8');

      await initLintConfig(tmpDir);

      const content = readFileSync(join(tmpDir, 'eslint.config.mjs'), 'utf-8');
      expect(content).toBe(existingConfig);
    });

    it('should not overwrite existing .eslintrc.json', async () => {
      writeFileSync(join(tmpDir, '.eslintrc.json'), '{}', 'utf-8');

      await initLintConfig(tmpDir);

      // Should not create eslint.config.mjs since .eslintrc.json exists
      expect(existsSync(join(tmpDir, 'eslint.config.mjs'))).toBe(false);
    });

    it('should not overwrite existing .prettierrc.json', async () => {
      writeFileSync(join(tmpDir, '.prettierrc.json'), '{"semi": false}', 'utf-8');

      await initLintConfig(tmpDir);

      // Should not create .prettierrc since .prettierrc.json exists
      expect(existsSync(join(tmpDir, '.prettierrc'))).toBe(false);
    });
  });
});
