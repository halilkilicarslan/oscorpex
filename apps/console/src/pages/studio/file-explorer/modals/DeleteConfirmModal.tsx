// ---------------------------------------------------------------------------
// Delete Confirm Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';

interface DeleteConfirmModalProps {
  filePath: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ filePath, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete file.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#141414] border border-[#262626] rounded-lg w-[400px] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
          <span className="text-[13px] font-medium text-[#d4d4d4]">Delete File</span>
          <button onClick={onCancel} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-[#a3a3a3]">Are you sure you want to delete this file?</p>
          <div className="bg-[#0a0a0a] rounded px-3 py-2 font-mono text-[12px] text-[#ef4444] border border-[#262626]">
            {filePath}
          </div>
          <p className="text-[11px] text-[#525252]">This action cannot be undone.</p>
          {error && <p className="text-[11px] text-[#ef4444]">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 disabled:opacity-50 transition-colors"
            >
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
