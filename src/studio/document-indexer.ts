// ---------------------------------------------------------------------------
// Oscorpex — Document Indexer
// Indexes documents and project codebases into the vector store for RAG.
// ---------------------------------------------------------------------------

import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { query, queryOne, execute } from './pg.js';
import { gitManager } from './git-manager.js';
import { vectorStore } from './vector-store.js';
import type { FileTreeNode } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexResult {
  docId: string;
  filename: string;
  chunkCount: number;
  status: 'indexed' | 'failed' | 'skipped';
  error?: string;
}

export interface CodebaseIndexOptions {
  projectPath: string;
  kbId: string;
  extensions?: string[];
  excludeDirs?: string[];
  maxFileSize?: number; // bytes — default 100 KB
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface CodebaseIndexSummary {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  totalChunks: number;
  errors: string[];
}

export interface ReindexSummary {
  changedFiles: number;
  reindexed: number;
  totalChunks: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.md', '.json', '.css'];
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.voltagent'];
const DEFAULT_MAX_FILE_SIZE = 100 * 1024; // 100 KB

// ---------------------------------------------------------------------------
// Binary file detection — skip files that cannot be meaningfully indexed
// ---------------------------------------------------------------------------

function looksLikeBinary(content: string): boolean {
  // If more than 5% of the first 1000 chars are non-printable, treat as binary
  const sample = content.slice(0, 1000);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32) || code === 127) {
      nonPrintable++;
    }
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.05;
}

// ---------------------------------------------------------------------------
// 1. Document Processing Pipeline
// ---------------------------------------------------------------------------

/**
 * Process and index a single document whose text content is already available.
 * Updates rag_documents (chunk_count, status) and rag_knowledge_bases
 * (document_count, total_chunks) in the studio DB.
 */
async function indexDocumentContent(
  kbId: string,
  docId: string,
  filename: string,
  content: string,
  options?: {
    chunkSize?: number;
    chunkOverlap?: number;
    model?: string;
  },
): Promise<IndexResult> {
  // Skip empty content
  if (!content || content.trim().length === 0) {
    console.log(`[DocumentIndexer] Skipping empty file: ${filename}`);
    return { docId, filename, chunkCount: 0, status: 'skipped', error: 'empty content' };
  }

  // Skip binary content
  if (looksLikeBinary(content)) {
    console.log(`[DocumentIndexer] Skipping binary file: ${filename}`);
    return { docId, filename, chunkCount: 0, status: 'skipped', error: 'binary file' };
  }

  try {
    const { chunkCount } = await vectorStore.indexDocument(
      kbId,
      docId,
      content,
      options?.chunkSize,
      options?.chunkOverlap,
      options?.model,
    );

    const now = new Date().toISOString();

    // Update document record
    await execute(
      `UPDATE rag_documents SET chunk_count = $1, status = 'ready' WHERE id = $2`,
      [chunkCount, docId],
    );

    // Increment KB counters
    await execute(
      `UPDATE rag_knowledge_bases
       SET
         document_count = document_count + 1,
         total_chunks   = total_chunks + $1,
         last_indexed_at = $2,
         updated_at     = $3
       WHERE id = $4`,
      [chunkCount, now, now, kbId],
    );

    console.log(`[DocumentIndexer] Indexed "${filename}" → ${chunkCount} chunks`);
    return { docId, filename, chunkCount, status: 'indexed' };
  } catch (err: any) {
    const error = err?.message ?? 'unknown error';
    console.error(`[DocumentIndexer] Failed to index "${filename}": ${error}`);

    // Mark document as failed in DB
    try {
      await execute(`UPDATE rag_documents SET status = 'failed' WHERE id = $1`, [docId]);
    } catch {
      // best-effort
    }

    return { docId, filename, chunkCount: 0, status: 'failed', error };
  }
}

// ---------------------------------------------------------------------------
// Helpers — flat walk of FileTreeNode[]
// ---------------------------------------------------------------------------

function flattenFileTree(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      paths.push(node.path);
    } else if (node.children) {
      paths.push(...flattenFileTree(node.children));
    }
  }
  return paths;
}

function matchesExcludeDir(filePath: string, excludeDirs: string[]): boolean {
  const parts = filePath.split(/[\\/]/);
  return parts.some((part) => excludeDirs.includes(part));
}

// ---------------------------------------------------------------------------
// 2. Codebase Indexer
// ---------------------------------------------------------------------------

/**
 * Index the entire codebase of a project into the given knowledge base.
 * Creates rag_documents entries for each file and calls indexDocumentContent.
 */
async function indexCodebase(options: CodebaseIndexOptions): Promise<CodebaseIndexSummary> {
  const {
    projectPath,
    kbId,
    extensions = DEFAULT_EXTENSIONS,
    excludeDirs = DEFAULT_EXCLUDE_DIRS,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    chunkSize,
    chunkOverlap,
  } = options;

  const now = new Date().toISOString();

  console.log(`[DocumentIndexer] Starting codebase index for KB ${kbId} at path: ${projectPath}`);

  // Walk file tree
  let allFiles: string[];
  try {
    const tree = await gitManager.getFileTree(projectPath);
    allFiles = flattenFileTree(tree);
  } catch (err: any) {
    console.error(`[DocumentIndexer] Failed to read file tree: ${err?.message}`);
    return { totalFiles: 0, indexedFiles: 0, skippedFiles: 0, totalChunks: 0, errors: [err?.message ?? 'file tree error'] };
  }

  // Filter by extension and excluded dirs
  const eligible = allFiles.filter((filePath) => {
    const ext = extname(filePath).toLowerCase();
    if (!extensions.includes(ext)) return false;
    if (matchesExcludeDir(filePath, excludeDirs)) return false;
    return true;
  });

  console.log(`[DocumentIndexer] Found ${eligible.length} eligible files (${allFiles.length} total)`);

  const summary: CodebaseIndexSummary = {
    totalFiles: eligible.length,
    indexedFiles: 0,
    skippedFiles: 0,
    totalChunks: 0,
    errors: [],
  };

  for (const filePath of eligible) {
    // Read file content
    let content: string;
    try {
      content = await gitManager.getFileContent(projectPath, filePath);
    } catch (err: any) {
      summary.skippedFiles++;
      summary.errors.push(`Read error for ${filePath}: ${err?.message ?? 'unknown'}`);
      continue;
    }

    // Check file size
    const sizeBytes = new TextEncoder().encode(content).length;
    if (sizeBytes > maxFileSize) {
      console.log(`[DocumentIndexer] Skipping oversized file (${sizeBytes} bytes): ${filePath}`);
      summary.skippedFiles++;
      continue;
    }

    // Create rag_documents entry with status 'pending'
    const docId = randomUUID();
    const contentPreview = content.slice(0, 500);

    try {
      await execute(
        `INSERT INTO rag_documents (id, kb_id, name, source, content_preview, chunk_count, size_bytes, status, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, $6, 'pending', '{}', $7)`,
        [docId, kbId, filePath, filePath, contentPreview, sizeBytes, now],
      );
    } catch (err: any) {
      summary.skippedFiles++;
      summary.errors.push(`DB insert error for ${filePath}: ${err?.message ?? 'unknown'}`);
      continue;
    }

    // Index the document
    const result = await indexDocumentContent(kbId, docId, filePath, content, { chunkSize, chunkOverlap });

    if (result.status === 'indexed') {
      summary.indexedFiles++;
      summary.totalChunks += result.chunkCount;
    } else {
      summary.skippedFiles++;
      if (result.error) {
        summary.errors.push(`${filePath}: ${result.error}`);
      }
    }
  }

  console.log(
    `[DocumentIndexer] Codebase index complete — indexed: ${summary.indexedFiles}, skipped: ${summary.skippedFiles}, chunks: ${summary.totalChunks}`,
  );

  return summary;
}

// ---------------------------------------------------------------------------
// 3. Incremental Re-index
// ---------------------------------------------------------------------------

/**
 * Re-index only files that have changed since last commit (or since sinceCommit).
 * Deletes old embeddings for changed files before re-indexing.
 */
async function reindexChanged(
  projectPath: string,
  kbId: string,
  sinceCommit?: string,
): Promise<ReindexSummary> {
  console.log(`[DocumentIndexer] Starting incremental re-index for KB ${kbId}`);

  // Collect changed file paths
  let changedPaths: string[] = [];
  try {
    if (sinceCommit) {
      const diff = await gitManager.getDiff(projectPath, sinceCommit);
      // Parse diff output for file paths — lines like "diff --git a/path b/path"
      const matches = diff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm);
      for (const match of matches) {
        changedPaths.push(match[1]);
      }
    } else {
      const status = await gitManager.getStatus(projectPath);
      changedPaths = [
        ...status.modified,
        ...status.untracked,
        ...status.staged,
      ];
    }
  } catch (err: any) {
    console.error(`[DocumentIndexer] Failed to determine changed files: ${err?.message}`);
    return { changedFiles: 0, reindexed: 0, totalChunks: 0 };
  }

  if (changedPaths.length === 0) {
    console.log('[DocumentIndexer] No changed files detected — nothing to re-index');
    return { changedFiles: 0, reindexed: 0, totalChunks: 0 };
  }

  console.log(`[DocumentIndexer] ${changedPaths.length} changed file(s) to re-index`);

  const summary: ReindexSummary = {
    changedFiles: changedPaths.length,
    reindexed: 0,
    totalChunks: 0,
  };

  const now = new Date().toISOString();

  for (const filePath of changedPaths) {
    // Find existing document record for this file
    const existing = await queryOne<{ id: string; chunk_count: number }>(
      'SELECT id, chunk_count FROM rag_documents WHERE kb_id = $1 AND source = $2',
      [kbId, filePath],
    );

    if (existing) {
      // Delete old embeddings from vector store
      try {
        await vectorStore.deleteDocEmbeddings(existing.id);
      } catch (err: any) {
        console.error(`[DocumentIndexer] Failed to delete embeddings for ${filePath}: ${err?.message}`);
      }

      // Update KB counters to remove old chunks
      await execute(
        `UPDATE rag_knowledge_bases
         SET
           document_count = GREATEST(0, document_count - 1),
           total_chunks   = GREATEST(0, total_chunks - $1),
           updated_at     = $2
         WHERE id = $3`,
        [existing.chunk_count, now, kbId],
      );

      // Remove old document record
      await execute('DELETE FROM rag_documents WHERE id = $1', [existing.id]);
    }

    // Read updated file content
    let content: string;
    try {
      content = await gitManager.getFileContent(projectPath, filePath);
    } catch {
      // File may have been deleted — skip
      console.log(`[DocumentIndexer] Skipping deleted/unreadable file: ${filePath}`);
      continue;
    }

    const sizeBytes = new TextEncoder().encode(content).length;
    const docId = randomUUID();
    const contentPreview = content.slice(0, 500);

    try {
      await execute(
        `INSERT INTO rag_documents (id, kb_id, name, source, content_preview, chunk_count, size_bytes, status, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, $6, 'pending', '{}', $7)`,
        [docId, kbId, filePath, filePath, contentPreview, sizeBytes, now],
      );
    } catch (err: any) {
      console.error(`[DocumentIndexer] DB insert error for ${filePath}: ${err?.message}`);
      continue;
    }

    const result = await indexDocumentContent(kbId, docId, filePath, content);

    if (result.status === 'indexed') {
      summary.reindexed++;
      summary.totalChunks += result.chunkCount;
    }
  }

  console.log(
    `[DocumentIndexer] Incremental re-index complete — reindexed: ${summary.reindexed}, chunks: ${summary.totalChunks}`,
  );

  return summary;
}

// ---------------------------------------------------------------------------
// 4. Auto-Index on Project Creation
// ---------------------------------------------------------------------------

/**
 * Create a knowledge base for a project and index its codebase.
 * Returns the kbId of the created knowledge base.
 */
async function autoIndexProject(
  projectId: string,
  projectPath: string,
  projectName: string,
): Promise<string> {
  const kbId = randomUUID();
  const now = new Date().toISOString();

  console.log(`[DocumentIndexer] Auto-indexing project "${projectName}" (${projectId})`);

  // Ensure RAG tables exist (idempotent)
  await execute(`
    CREATE TABLE IF NOT EXISTS rag_knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text',
      embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
      chunk_size INTEGER NOT NULL DEFAULT 512,
      chunk_overlap INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'active',
      document_count INTEGER NOT NULL DEFAULT 0,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      last_indexed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES rag_knowledge_bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      source TEXT DEFAULT '',
      content_preview TEXT DEFAULT '',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);

  await execute(`CREATE INDEX IF NOT EXISTS idx_rag_docs_kb ON rag_documents(kb_id)`);

  // Create the knowledge base record
  await execute(
    `INSERT INTO rag_knowledge_bases (id, name, description, type, embedding_model, chunk_size, chunk_overlap, status, document_count, total_chunks, last_indexed_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'code', 'text-embedding-3-small', 512, 50, 'active', 0, 0, NULL, $4, $5)`,
    [
      kbId,
      `${projectName} — Codebase`,
      `Auto-indexed codebase for project: ${projectName} (${projectId})`,
      now,
      now,
    ],
  );

  // Index the codebase
  await indexCodebase({ projectPath, kbId });

  console.log(`[DocumentIndexer] Project "${projectName}" auto-indexed — kbId: ${kbId}`);
  return kbId;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const documentIndexer = {
  indexDocumentContent,
  indexCodebase,
  reindexChanged,
  autoIndexProject,
};
