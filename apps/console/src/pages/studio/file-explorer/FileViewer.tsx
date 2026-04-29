// ---------------------------------------------------------------------------
// File Viewer
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { Loader2, Pencil, Copy, Check, Save, X, GitCommit } from 'lucide-react';
import type { GitStatusResult } from '../../../lib/studio-api';
import { httpGet, httpPut } from '../../../lib/studio-api/base.js';

interface FileViewerProps {
  path: string;
  projectId: string;
  gitStatus: GitStatusResult;
  onClose: () => void;
  onCommitRequest: () => void;
}

export default function FileViewer({ path, projectId, gitStatus, onClose, onCommitRequest }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const isModified =
    gitStatus.modified.includes(path) ||
    gitStatus.staged.includes(path) ||
    gitStatus.untracked.includes(path);

  useEffect(() => {
    setLoading(true);
    setEditing(false);
    setSaveStatus('idle');
    httpGet<{ content?: string }>(`/api/studio/projects/${projectId}/files/${path}`)
      .then((data) => {
        const c = data.content ?? 'Unable to read file';
        setContent(c);
        setEditContent(c);
      })
      .catch(() => setContent('Error loading file'))
      .finally(() => setLoading(false));
  }, [path, projectId]);

  const handleCopy = () => {
    const text = editing ? editContent : content;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEdit = () => {
    setEditContent(content ?? '');
    setEditing(true);
    setSaveStatus('idle');
  };

  const handleCancel = () => {
    setEditing(false);
    setEditContent(content ?? '');
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      await httpPut(`/api/studio/projects/${projectId}/files/${path}`, { content: editContent });
      setContent(editContent);
      setEditing(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#262626] bg-[#0d0d0d]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] text-[#a3a3a3] font-mono truncate">{path}</span>
          {isModified && (
            <span className="text-[10px] text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded shrink-0">
              MODIFIED
            </span>
          )}
          {editing && (
            <span className="text-[10px] text-[#3b82f6] bg-[#3b82f6]/10 px-1.5 py-0.5 rounded shrink-0">
              EDITING
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-[10px] text-[#22c55e] shrink-0">Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-[10px] text-[#ef4444] shrink-0">Save failed</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCommitRequest}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20 transition-colors"
            title="Create commit"
          >
            <GitCommit size={12} />
            Commit
          </button>

          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
              >
                <X size={12} />
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleEdit}
                className="p-1 rounded text-[#525252] hover:text-[#f59e0b] transition-colors"
                title="Edit file"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={handleCopy}
                className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] transition-colors"
                title="Copy content"
              >
                {copied ? <Check size={14} className="text-[#22c55e]" /> : <Copy size={14} />}
              </button>
              <button
                onClick={onClose}
                className="text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={16} className="text-[#525252] animate-spin" />
        </div>
      ) : editing ? (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="flex-1 w-full p-4 text-[12px] leading-relaxed text-[#d4d4d4] font-mono bg-[#0a0a0a] border-none outline-none resize-none"
          spellCheck={false}
        />
      ) : (
        <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed text-[#d4d4d4] font-mono bg-[#0a0a0a]">
          {content}
        </pre>
      )}
    </div>
  );
}
