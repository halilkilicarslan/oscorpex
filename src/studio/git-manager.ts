// ---------------------------------------------------------------------------
// Oscorpex — Git Manager
// Branch management, commits, merges, file tree, diffs
// ---------------------------------------------------------------------------

import { simpleGit, type SimpleGit } from 'simple-git';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, normalize } from 'node:path';
import type { GitLogEntry, FileTreeNode, MergeResult, GitStatus } from './types.js';

class GitManager {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }

  // -------------------------------------------------------------------------
  // Repository setup
  // -------------------------------------------------------------------------

  async initRepo(projectPath: string): Promise<void> {
    const git = this.getGit(projectPath);
    await git.init();
    await git.addConfig('user.name', 'Oscorpex');
    await git.addConfig('user.email', 'studio@ai-dev.local');

    // Create initial commit so branches work
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(projectPath, '.gitkeep'), '');
    await git.add('.gitkeep');
    await git.commit('Initial commit');
  }

  async isRepo(projectPath: string): Promise<boolean> {
    try {
      const git = this.getGit(projectPath);
      return await git.checkIsRepo();
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Branch operations
  // -------------------------------------------------------------------------

  async createBranch(projectPath: string, branchName: string): Promise<void> {
    const git = this.getGit(projectPath);
    await git.checkoutLocalBranch(branchName);
  }

  async checkout(projectPath: string, branch: string): Promise<void> {
    const git = this.getGit(projectPath);
    await git.checkout(branch);
  }

  async getCurrentBranch(projectPath: string): Promise<string> {
    const git = this.getGit(projectPath);
    const status = await git.status();
    return status.current ?? 'main';
  }

  async listBranches(projectPath: string): Promise<string[]> {
    const git = this.getGit(projectPath);
    const result = await git.branchLocal();
    return result.all;
  }

  // -------------------------------------------------------------------------
  // Commit operations
  // -------------------------------------------------------------------------

  async commit(projectPath: string, message: string): Promise<string> {
    const git = this.getGit(projectPath);
    await git.add('.');
    const result = await git.commit(message);
    return result.commit;
  }

  async commitFiles(projectPath: string, files: string[], message: string): Promise<string> {
    const git = this.getGit(projectPath);
    await git.add(files);
    const result = await git.commit(message);
    return result.commit;
  }

  // -------------------------------------------------------------------------
  // Merge operations
  // -------------------------------------------------------------------------

  async merge(projectPath: string, source: string, target: string): Promise<MergeResult> {
    const git = this.getGit(projectPath);

    await git.checkout(target);

    try {
      await git.merge([source]);
      return { success: true };
    } catch (error: any) {
      // Extract conflict files
      const status = await git.status();
      const conflicts = status.conflicted;

      if (conflicts.length > 0) {
        // Abort the failed merge
        await git.merge(['--abort']);
        return { success: false, conflicts };
      }

      throw error;
    }
  }

  /**
   * Kaynak branch'i hedef branch'e merge eder.
   * merge() fonksiyonunun API dostu alias'ı — route'lardan çağrılmak üzere.
   * Conflict durumunda { success: false, conflicts: [...] } döner.
   * Merge başarılıysa hedef branch'e geçişi de gerçekleştirir.
   */
  async mergeBranch(
    projectPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<MergeResult> {
    return this.merge(projectPath, sourceBranch, targetBranch);
  }

  // -------------------------------------------------------------------------
  // Commit geri alma (revert)
  // -------------------------------------------------------------------------

  /**
   * Belirli bir commit'i geri alır.
   * `git revert --no-edit {hash}` komutuyla yeni bir revert commit oluşturur.
   * Orijinal commit'i silmez; güvenli bir geri alma yöntemidir.
   */
  async revertCommit(projectPath: string, commitHash: string): Promise<string> {
    const git = this.getGit(projectPath);

    // Hash formatını doğrula — sadece hex karakterlere izin ver
    if (!/^[0-9a-f]{4,40}$/i.test(commitHash)) {
      throw new Error(`Geçersiz commit hash: ${commitHash}`);
    }

    try {
      // --no-edit: otomatik commit mesajı kullan, editör açma
      await git.raw(['revert', '--no-edit', commitHash]);
      // Revert sonrası oluşan commit'in hash'ini döndür
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash.slice(0, 8) ?? '';
    } catch (error: any) {
      // Merge conflict durumunda revert'i iptal et
      try {
        await git.raw(['revert', '--abort']);
      } catch {
        // Abort başarısız olursa yoksay
      }
      const msg = error?.message ?? 'Revert başarısız oldu';
      throw new Error(`Commit geri alınamadı: ${msg}`);
    }
  }

  /**
   * Son N commit'i döndürür.
   * Her kayıtta: hash (kısa), message, date (ISO), author bilgisi bulunur.
   * getLog() ile aynı işlevi görür — API tutarlılığı için alias olarak eklendi.
   */
  async getCommitLog(
    projectPath: string,
    limit = 20,
  ): Promise<GitLogEntry[]> {
    return this.getLog(projectPath, limit);
  }

  // -------------------------------------------------------------------------
  // Log & diff
  // -------------------------------------------------------------------------

  async getLog(projectPath: string, limit = 50): Promise<GitLogEntry[]> {
    const git = this.getGit(projectPath);

    try {
      const log = await git.log({ maxCount: limit });
      return log.all.map((entry) => ({
        hash: entry.hash.slice(0, 8),
        message: entry.message,
        author: entry.author_name,
        date: entry.date,
      }));
    } catch {
      return [];
    }
  }

  async getDiff(projectPath: string, ref?: string): Promise<string> {
    const git = this.getGit(projectPath);

    if (ref) {
      return git.diff([ref]);
    }
    // Unstaged + staged changes
    return git.diff(['HEAD']);
  }

  async getDiffBetween(projectPath: string, from: string, to: string): Promise<string> {
    const git = this.getGit(projectPath);
    return git.diff([`${from}...${to}`]);
  }

  // -------------------------------------------------------------------------
  // File tree & content
  // -------------------------------------------------------------------------

  async getFileTree(projectPath: string, subPath = ''): Promise<FileTreeNode[]> {
    const fullPath = subPath ? join(projectPath, subPath) : projectPath;
    const entries = await readdir(fullPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    for (const entry of entries) {
      // Skip hidden files/dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const entryPath = relative(projectPath, join(fullPath, entry.name));

      if (entry.isDirectory()) {
        const children = await this.getFileTree(projectPath, entryPath);
        nodes.push({
          name: entry.name,
          path: entryPath,
          type: 'directory',
          children,
        });
      } else {
        nodes.push({
          name: entry.name,
          path: entryPath,
          type: 'file',
        });
      }
    }

    // Sort: directories first, then alphabetical
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getFileContent(projectPath: string, filePath: string): Promise<string> {
    const fullPath = join(projectPath, filePath);

    // Security: prevent path traversal
    if (!fullPath.startsWith(projectPath)) {
      throw new Error('Invalid file path');
    }

    return readFile(fullPath, 'utf-8');
  }

  async writeFileContent(projectPath: string, filePath: string, content: string): Promise<void> {
    const fullPath = join(projectPath, filePath);
    if (!fullPath.startsWith(projectPath)) {
      throw new Error('Invalid file path');
    }
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  // -------------------------------------------------------------------------
  // File create / delete
  // -------------------------------------------------------------------------

  /** Yeni dosya oluşturur. Dosya zaten mevcutsa hata fırlatır. */
  async createFile(projectPath: string, filePath: string, content = ''): Promise<void> {
    // Güvenlik: path traversal engelleme
    const normalized = normalize(filePath);
    if (normalized.includes('..')) {
      throw new Error('Invalid file path: directory traversal not allowed');
    }

    const fullPath = join(projectPath, normalized);
    if (!fullPath.startsWith(projectPath)) {
      throw new Error('Invalid file path');
    }

    // Dosya zaten var mı kontrol et
    try {
      await stat(fullPath);
      throw new Error(`File already exists: ${filePath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  /** Belirtilen dosyayı siler. */
  async deleteFile(projectPath: string, filePath: string): Promise<void> {
    const normalized = normalize(filePath);
    if (normalized.includes('..')) {
      throw new Error('Invalid file path: directory traversal not allowed');
    }

    const fullPath = join(projectPath, normalized);
    if (!fullPath.startsWith(projectPath)) {
      throw new Error('Invalid file path');
    }

    const { unlink } = await import('node:fs/promises');
    await unlink(fullPath);
  }

  // -------------------------------------------------------------------------
  // Git status & commit
  // -------------------------------------------------------------------------

  /** Çalışma dizininin git durumunu döndürür. */
  async getStatus(projectPath: string): Promise<import('./types.js').GitStatus> {
    const git = this.getGit(projectPath);
    try {
      const status = await git.status();
      return {
        modified: status.modified,
        untracked: status.not_added,
        staged: status.staged,
        deleted: status.deleted,
      };
    } catch {
      return { modified: [], untracked: [], staged: [], deleted: [] };
    }
  }

  /**
   * Değişiklikleri commit eder.
   * - `files` belirtilirse yalnızca o dosyalar stage edilir.
   * - `files` belirtilmezse tüm değişiklikler (git add .) eklenir.
   * - Stage edilecek değişiklik yoksa hata fırlatır.
   */
  async commitChanges(projectPath: string, message: string, files?: string[]): Promise<string> {
    const git = this.getGit(projectPath);

    if (files && files.length > 0) {
      // Path traversal kontrolü
      for (const f of files) {
        const normalized = normalize(f);
        if (normalized.includes('..')) {
          throw new Error(`Invalid file path: ${f}`);
        }
      }
      await git.add(files);
    } else {
      await git.add('.');
    }

    // Stage edilmiş değişiklik var mı kontrol et
    const status = await git.status();
    if (status.staged.length === 0) {
      throw new Error('Nothing to commit: no staged changes');
    }

    const result = await git.commit(message);
    return result.commit;
  }

  async getFileStats(projectPath: string, filePath: string): Promise<{ size: number; modified: string }> {
    const fullPath = join(projectPath, filePath);
    if (!fullPath.startsWith(projectPath)) throw new Error('Invalid file path');

    const s = await stat(fullPath);
    return { size: s.size, modified: s.mtime.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Docs system helpers
  // -------------------------------------------------------------------------

  /** Initialize docs/ folder structure for a new project */
  async initDocs(projectPath: string): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const docsDir = join(projectPath, 'docs');
    await mkdir(docsDir, { recursive: true });

    const files: Record<string, string> = {
      'PROJECT.md': '# Project\n\n> Generated by Oscorpex Planner.\n\n## Overview\n\nTBD\n\n## Requirements\n\nTBD\n',
      'ARCHITECTURE.md': '# Architecture\n\n> Generated by Oscorpex Architect Agent.\n\nTBD\n',
      'CODING_STANDARDS.md': '# Coding Standards\n\nTBD\n',
      'API_CONTRACT.md': '# API Contract\n\nTBD\n',
      'CHANGELOG.md': '# Changelog\n\nAll notable changes to this project.\n',
      'DECISIONS.md': '# Decision Log\n\n| Date | Decision | Rationale | Agent |\n|------|----------|-----------|-------|\n',
    };

    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(docsDir, name), content, 'utf-8');
    }
  }

  /** Read a doc file relative to the project's docs/ folder */
  async readDoc(projectPath: string, docName: string): Promise<string | null> {
    try {
      return await readFile(join(projectPath, 'docs', docName), 'utf-8');
    } catch {
      return null;
    }
  }

  /** Build context string from relevant docs for a given agent role */
  async buildAgentContext(projectPath: string, role: string): Promise<string> {
    const docs: string[] = [];

    // Always include coding standards
    const standards = await this.readDoc(projectPath, 'CODING_STANDARDS.md');
    if (standards) docs.push(standards);

    // Role-specific docs
    if (role === 'backend' || role === 'coder') {
      const api = await this.readDoc(projectPath, 'API_CONTRACT.md');
      if (api) docs.push(api);
    }

    if (role === 'frontend' || role === 'coder') {
      const api = await this.readDoc(projectPath, 'API_CONTRACT.md');
      if (api && !docs.includes(api)) docs.push(api);
    }

    if (role === 'architect') {
      const arch = await this.readDoc(projectPath, 'ARCHITECTURE.md');
      if (arch) docs.push(arch);
    }

    // Always include project overview
    const project = await this.readDoc(projectPath, 'PROJECT.md');
    if (project) docs.unshift(project);

    return docs.join('\n\n---\n\n');
  }
}

export const gitManager = new GitManager();
