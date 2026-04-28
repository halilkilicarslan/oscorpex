// ---------------------------------------------------------------------------
// Commit Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { GitCommit, X, Loader2 } from 'lucide-react';
import { commitChanges, type GitStatusResult } from '../../../../lib/studio-api';

interface CommitModalProps {
  projectId: string;
  gitStatus: GitStatusResult;
  currentFile?: string | null;
  onCommitted: () => void;
  onCancel: () => void;
}

export default function CommitModal({ projectId, gitStatus, currentFile, onCommitted, onCancel }: CommitModalProps) {
  const allChangedFiles = [
    ...gitStatus.modified.map((f) => ({ path: f, type: 'modified' as const })),
    ...gitStatus.untracked.map((f) => ({ path: f, type: 'untracked' as const })),
    ...gitStatus.deleted.map((f) => ({ path: f, type: 'deleted' as const })),
  ];

  const [message, setMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    new Set(currentFile ? [currentFile] : allChangedFiles.map((f) => f.path)),
  );
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCommit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Commit mesajı boş olamaz.');
      return;
    }
    if (selectedFiles.size === 0) {
      setError('En az bir dosya seçmelisiniz.');
      return;
    }
    setCommitting(true);
    setError('');
    try {
      await commitChanges(projectId, trimmed, Array.from(selectedFiles));
      onCommitted();
    } catch (err: any) {
      setError(err?.message ?? 'Commit başarısız.');
      setCommitting(false);
    }
  };

  const typeColor = (type: 'modified' | 'untracked' | 'deleted') => {
    if (type === 'modified') return 'text-[#f59e0b]';
    if (type === 'deleted') return 'text-[#ef4444]';
    return 'text-[#22c55e]';
  };

  const typeLabel = (type: 'modified' | 'untracked' | 'deleted') => {
    if (type === 'modified') return 'M';
    if (type === 'deleted') return 'D';
    return 'U';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#141414] border border-[#262626] rounded-lg w-[520px] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
          <div className="flex items-center gap-2">
            <GitCommit size={14} className="text-[#22c55e]" />
            <span className="text-[13px] font-medium text-[#d4d4d4]">Create Commit</span>
          </div>
          <button onClick={onCancel} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-[#737373] mb-1">Commit Message</label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="feat: add new feature"
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-[12px] text-[#d4d4d4] font-mono placeholder-[#404040] outline-none focus:border-[#22c55e] transition-colors"
              autoFocus
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] text-[#737373]">
                Files to commit ({selectedFiles.size}/{allChangedFiles.length})
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedFiles(new Set(allChangedFiles.map((f) => f.path)))}
                  className="text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() => setSelectedFiles(new Set())}
                  className="text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
                >
                  None
                </button>
              </div>
            </div>

            {allChangedFiles.length === 0 ? (
              <div className="bg-[#0a0a0a] border border-[#262626] rounded px-3 py-4 text-center">
                <p className="text-[11px] text-[#525252]">No changes to commit.</p>
              </div>
            ) : (
              <div className="bg-[#0a0a0a] border border-[#262626] rounded max-h-[200px] overflow-y-auto divide-y divide-[#1a1a1a]">
                {allChangedFiles.map(({ path, type }) => (
                  <label
                    key={path}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#141414] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(path)}
                      onChange={() => toggleFile(path)}
                      className="accent-[#22c55e]"
                    />
                    <span className={`text-[10px] font-bold w-3 shrink-0 ${typeColor(type)}`}>
                      {typeLabel(type)}
                    </span>
                    <span className="text-[11px] text-[#a3a3a3] font-mono truncate">{path}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-[11px] text-[#ef4444]">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCommit}
              disabled={committing || allChangedFiles.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-50 transition-colors"
            >
              {committing ? <Loader2 size={11} className="animate-spin" /> : <GitCommit size={11} />}
              Commit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
