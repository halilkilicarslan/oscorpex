import type {
  GitStatusResult,
  GitStatus,
  GitLogEntry,
  RevertResult,
  BranchesResult,
  MergeResult,
} from './types.js';
import { API, json } from './base.js';

export async function createFile(projectId: string, filePath: string, content = ''): Promise<{ path: string; created: boolean }> {
  return json(`${API}/projects/${projectId}/files`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
}

export async function deleteFile(projectId: string, filePath: string): Promise<{ path: string; deleted: boolean }> {
  return json(`${API}/projects/${projectId}/files`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
}

export async function getGitStatus(projectId: string): Promise<GitStatusResult> {
  return json(`${API}/projects/${projectId}/git/status`);
}

export async function commitChanges(projectId: string, message: string, files?: string[]): Promise<{ commit: string; message: string }> {
  return json(`${API}/projects/${projectId}/git/commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, files }),
  });
}

export async function fetchGitStatus(projectId: string): Promise<GitStatus> {
  return json(`${API}/projects/${projectId}/git/status`);
}

export async function fetchGitDiff(projectId: string, ref?: string): Promise<{ diff: string }> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return json(`${API}/projects/${projectId}/git/diff${q}`);
}

export async function fetchGitLog(projectId: string): Promise<GitLogEntry[]> {
  return json(`${API}/projects/${projectId}/git/log`);
}

/**
 * Son `limit` kadar commit'i döndürür.
 * Commit geçmişi listesi için fetchGitLog'dan daha granüler kontrol sağlar.
 */
export async function fetchCommitLog(projectId: string, limit = 20): Promise<GitLogEntry[]> {
  return json(`${API}/projects/${projectId}/git/log?limit=${limit}`);
}

/**
 * Belirli bir commit'i geri alır.
 * `git revert --no-edit` kullanır — orijinal commit silinmez.
 */
export async function revertCommit(projectId: string, commitHash: string): Promise<RevertResult> {
  return json(`${API}/projects/${projectId}/git/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitHash }),
  });
}

/** Projenin branch listesini ve aktif branch'i döndürür. */
export async function fetchBranches(projectId: string): Promise<BranchesResult> {
  return json(`${API}/projects/${projectId}/git/branches`);
}

/**
 * Kaynak branch'i hedef branch'e merge eder.
 * Conflict durumunda `success: false` ve çakışan dosyalar döner.
 */
export async function mergeBranch(
  projectId: string,
  source: string,
  target: string,
): Promise<MergeResult> {
  return json(`${API}/projects/${projectId}/git/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target }),
  });
}
