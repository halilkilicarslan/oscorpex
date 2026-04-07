import { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, Loader2, FileCode, Plus, Minus, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchGitDiff, fetchGitStatus, fetchGitLog, type GitStatus, type GitLogEntry } from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Diff parser — splits unified diff into per-file hunks
// ---------------------------------------------------------------------------

interface DiffFile {
  path: string;
  hunks: string[];
  additions: number;
  deletions: number;
}

function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];
  const files: DiffFile[] = [];
  const parts = raw.split(/^diff --git /m).filter(Boolean);

  for (const part of parts) {
    const lines = part.split('\n');
    // Extract file path from "a/path b/path"
    const header = lines[0] ?? '';
    const match = header.match(/b\/(.+)/);
    const path = match?.[1] ?? header;

    let additions = 0;
    let deletions = 0;
    const hunks: string[] = [];
    let currentHunk = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('@@')) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = line + '\n';
      } else if (currentHunk) {
        currentHunk += line + '\n';
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    files.push({ path, hunks, additions, deletions });
  }

  return files;
}

// ---------------------------------------------------------------------------
// Single file diff
// ---------------------------------------------------------------------------

function FileDiff({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-[#262626] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#111111] hover:bg-[#1a1a1a] transition-colors text-left"
      >
        {expanded ? <ChevronDown size={14} className="text-[#525252]" /> : <ChevronRight size={14} className="text-[#525252]" />}
        <FileCode size={14} className="text-[#737373]" />
        <span className="text-[12px] text-[#fafafa] font-mono flex-1 truncate">{file.path}</span>
        <span className="text-[11px] text-[#22c55e]">+{file.additions}</span>
        <span className="text-[11px] text-[#ef4444]">-{file.deletions}</span>
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          {file.hunks.map((hunk, i) => (
            <pre key={i} className="text-[11px] leading-[18px] font-mono px-3 py-1">
              {hunk.split('\n').map((line, j) => {
                let cls = 'text-[#737373]';
                let bg = '';
                if (line.startsWith('+') && !line.startsWith('+++')) {
                  cls = 'text-[#22c55e]';
                  bg = 'bg-[#22c55e]/5';
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                  cls = 'text-[#ef4444]';
                  bg = 'bg-[#ef4444]/5';
                } else if (line.startsWith('@@')) {
                  cls = 'text-[#3b82f6]';
                  bg = 'bg-[#3b82f6]/5';
                }
                return (
                  <div key={j} className={`${cls} ${bg} px-1 -mx-1 rounded-sm`}>
                    {line || ' '}
                  </div>
                );
              })}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DiffViewer component
// ---------------------------------------------------------------------------

export default function DiffViewer({ projectId }: { projectId: string }) {
  const [diff, setDiff] = useState('');
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRef, setSelectedRef] = useState('');

  const load = async (ref?: string) => {
    setLoading(true);
    setError('');
    try {
      const [diffRes, statusRes, logRes] = await Promise.all([
        fetchGitDiff(projectId, ref),
        fetchGitStatus(projectId),
        fetchGitLog(projectId),
      ]);
      setDiff(diffRes.diff);
      setFiles(parseDiff(diffRes.diff));
      setStatus(statusRes);
      setLog(logRes);
    } catch (err: any) {
      setError(err?.message || 'Failed to load git data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId]);

  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold text-[#fafafa]">Diff Viewer</h2>
          {status && (
            <span className="flex items-center gap-1 text-[11px] text-[#737373] bg-[#1f1f1f] px-2 py-0.5 rounded-full">
              <GitBranch size={11} />
              {status.modified.length + status.staged.length + status.untracked.length + status.deleted.length} changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Compare against a commit */}
          {log.length > 0 && (
            <select
              value={selectedRef}
              onChange={(e) => { setSelectedRef(e.target.value); load(e.target.value || undefined); }}
              className="px-2 py-1 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[11px] text-[#a3a3a3] focus:outline-none focus:border-[#22c55e] max-w-[200px]"
            >
              <option value="">Working tree</option>
              {log.slice(0, 20).map((entry) => (
                <option key={entry.hash} value={entry.hash}>
                  {entry.hash.slice(0, 7)} — {entry.message.slice(0, 40)}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => load(selectedRef || undefined)}
            disabled={loading}
            className="p-1.5 rounded-lg border border-[#262626] hover:border-[#333] text-[#737373] hover:text-[#a3a3a3] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Status summary */}
      {status && (status.staged.length > 0 || status.modified.length > 0 || status.untracked.length > 0 || status.deleted.length > 0) && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {status.staged.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20">
              {status.staged.length} staged
            </span>
          )}
          {status.modified.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20">
              {status.modified.length} modified
            </span>
          )}
          {status.untracked.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20">
              {status.untracked.length} untracked
            </span>
          )}
          {status.deleted.length > 0 && (
            <span className="px-2 py-0.5 rounded bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20">
              {status.deleted.length} deleted
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="text-[#525252] animate-spin" />
        </div>
      )}

      {/* No changes */}
      {!loading && !error && files.length === 0 && (
        <div className="bg-[#111111] border border-[#262626] rounded-xl p-12 flex flex-col items-center text-center">
          <GitBranch size={24} className="text-[#333] mb-3" />
          <p className="text-[13px] text-[#525252]">No changes detected</p>
        </div>
      )}

      {/* Diff summary + file list */}
      {!loading && files.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-[12px] text-[#737373]">
            <span>{files.length} file{files.length > 1 ? 's' : ''} changed</span>
            <span className="flex items-center gap-0.5 text-[#22c55e]"><Plus size={12} />{totalAdd}</span>
            <span className="flex items-center gap-0.5 text-[#ef4444]"><Minus size={12} />{totalDel}</span>
          </div>
          <div className="space-y-3">
            {files.map((file) => (
              <FileDiff key={file.path} file={file} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
