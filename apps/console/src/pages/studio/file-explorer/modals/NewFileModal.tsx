// ---------------------------------------------------------------------------
// New File Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';

interface NewFileModalProps {
  onConfirm: (path: string, content: string) => Promise<void>;
  onCancel: () => void;
}

export default function NewFileModal({ onConfirm, onCancel }: NewFileModalProps) {
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = filePath.trim();
    if (!trimmed) {
      setError('File path cannot be empty.');
      return;
    }
    if (trimmed.includes('..')) {
      setError('Invalid path: ".." is not allowed.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onConfirm(trimmed, content);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create file.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#141414] border border-[#262626] rounded-lg w-[480px] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
          <span className="text-[13px] font-medium text-[#d4d4d4]">Create New File</span>
          <button onClick={onCancel} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-[#737373] mb-1">File Path</label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="src/components/MyComponent.tsx"
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-[12px] text-[#d4d4d4] font-mono placeholder-[#404040] outline-none focus:border-[#3b82f6] transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#737373] mb-1">Initial Content (optional)</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="// File content..."
              rows={5}
              className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-[12px] text-[#d4d4d4] font-mono placeholder-[#404040] outline-none focus:border-[#3b82f6] transition-colors resize-none"
            />
          </div>
          {error && <p className="text-[11px] text-[#ef4444]">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium bg-[#3b82f6]/10 text-[#3b82f6] hover:bg-[#3b82f6]/20 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
