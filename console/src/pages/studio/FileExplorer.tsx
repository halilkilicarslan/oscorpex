import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  FolderTree,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  ChevronRight,
  ChevronDown,
  GitBranch,
  GitCommit,
  Copy,
  Check,
  Pencil,
  Save,
  X,
  Plus,
  Trash2,
  Circle,
  RefreshCw,
} from 'lucide-react';
import {
  createFile,
  deleteFile,
  getGitStatus,
  commitChanges,
  type GitStatusResult,
} from '../../lib/studio-api';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: FileNode[];
}

// ---------------------------------------------------------------------------
// Dosya ikon yardımcısı
// ---------------------------------------------------------------------------

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'css', 'scss', 'html', 'json', 'yaml', 'yml', 'toml'];
  if (codeExts.includes(ext)) return <FileCode size={14} className="text-[#3b82f6]" />;
  return <FileText size={14} className="text-[#737373]" />;
}

// ---------------------------------------------------------------------------
// Yeni Dosya Modal
// ---------------------------------------------------------------------------

function NewFileModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (path: string, content: string) => Promise<void>;
  onCancel: () => void;
}) {
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

// ---------------------------------------------------------------------------
// Silme Onay Modal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  filePath,
  onConfirm,
  onCancel,
}: {
  filePath: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
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
          <p className="text-[12px] text-[#a3a3a3]">
            Are you sure you want to delete this file?
          </p>
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

// ---------------------------------------------------------------------------
// Commit Modal
// ---------------------------------------------------------------------------

function CommitModal({
  projectId,
  gitStatus,
  currentFile,
  onCommitted,
  onCancel,
}: {
  projectId: string;
  gitStatus: GitStatusResult;
  currentFile?: string | null;
  onCommitted: () => void;
  onCancel: () => void;
}) {
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
          {/* Commit mesajı */}
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

          {/* Dosya listesi */}
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

// ---------------------------------------------------------------------------
// Ağaç düğümü
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  path,
  depth,
  onSelect,
  onDelete,
  gitStatus,
}: {
  node: FileNode;
  path: string;
  depth: number;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  gitStatus: GitStatusResult;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [hovered, setHovered] = useState(false);
  const fullPath = path ? `${path}/${node.name}` : node.name;
  const isDir = node.type === 'directory';

  // Git durum göstergeleri
  const isModified = !isDir && (gitStatus.modified.includes(fullPath) || gitStatus.staged.includes(fullPath));
  const isUntracked = !isDir && gitStatus.untracked.includes(fullPath);
  const isDeleted = !isDir && gitStatus.deleted.includes(fullPath);

  return (
    <div>
      <div
        className="group relative flex items-center"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          onClick={() => {
            if (isDir) setExpanded(!expanded);
            else onSelect(fullPath);
          }}
          className="flex-1 flex items-center gap-1.5 px-2 py-1 hover:bg-[#1f1f1f] rounded text-left transition-colors min-w-0"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isDir ? (
            <>
              {expanded ? (
                <ChevronDown size={12} className="text-[#525252] shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-[#525252] shrink-0" />
              )}
              {expanded ? (
                <FolderOpen size={14} className="text-[#f59e0b] shrink-0" />
              ) : (
                <Folder size={14} className="text-[#f59e0b] shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              {getFileIcon(node.name)}
            </>
          )}
          <span className={`text-[12px] truncate ${isDeleted ? 'text-[#ef4444] line-through' : 'text-[#d4d4d4]'}`}>
            {node.name}
          </span>

          {/* Git durum noktası */}
          {isModified && (
            <Circle size={6} className="shrink-0 fill-[#f59e0b] text-[#f59e0b] ml-auto mr-1" />
          )}
          {isUntracked && (
            <Circle size={6} className="shrink-0 fill-[#22c55e] text-[#22c55e] ml-auto mr-1" />
          )}
          {isDeleted && (
            <Circle size={6} className="shrink-0 fill-[#ef4444] text-[#ef4444] ml-auto mr-1" />
          )}
        </button>

        {/* Silme butonu — yalnızca dosyalarda ve hover'da */}
        {!isDir && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(fullPath);
            }}
            className="absolute right-1 p-1 rounded text-[#525252] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
            title="Delete file"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {isDir && expanded && node.children && (
        <div>
          {node.children
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
              <TreeNode
                key={child.name}
                node={child}
                path={fullPath}
                depth={depth + 1}
                onSelect={onSelect}
                onDelete={onDelete}
                gitStatus={gitStatus}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dosya görüntüleyici
// ---------------------------------------------------------------------------

function FileViewer({
  path,
  projectId,
  gitStatus,
  onClose,
  onCommitRequest,
}: {
  path: string;
  projectId: string;
  gitStatus: GitStatusResult;
  onClose: () => void;
  onCommitRequest: () => void;
}) {
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
    fetch(`/api/studio/projects/${projectId}/files/${path}`)
      .then((r) => r.json())
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
      const res = await fetch(`/api/studio/projects/${projectId}/files/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) throw new Error();
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
      {/* Dosya başlığı */}
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
          {/* Commit butonu */}
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

      {/* İçerik */}
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

// ---------------------------------------------------------------------------
// Ana bileşen
// ---------------------------------------------------------------------------

export default function FileExplorer({ projectId }: { projectId: string }) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ branches: string[]; current: string }>({
    branches: [],
    current: '',
  });
  const [noRepo, setNoRepo] = useState(false);

  // Git durumu
  const [gitStatus, setGitStatus] = useState<GitStatusResult>({
    modified: [],
    untracked: [],
    staged: [],
    deleted: [],
  });

  // Modal durumları
  const [showNewFile, setShowNewFile] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showCommit, setShowCommit] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  // Dosya ağacı ve branch bilgilerini yükle
  const load = useCallback(async () => {
    try {
      const [treeRes, branchRes] = await Promise.allSettled([
        fetch(`/api/studio/projects/${projectId}/files`).then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        }),
        fetch(`/api/studio/projects/${projectId}/git/branches`).then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        }),
      ]);

      if (treeRes.status === 'fulfilled') {
        setTree(treeRes.value);
        setNoRepo(false);
      } else {
        setNoRepo(true);
      }

      if (branchRes.status === 'fulfilled') {
        setBranches(branchRes.value);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Git durumunu yükle
  const refreshGitStatus = useCallback(async () => {
    setStatusRefreshing(true);
    try {
      const status = await getGitStatus(projectId);
      setGitStatus(status);
    } catch {
      // Git durumu alınamazsa sessizce yoksay
    } finally {
      setStatusRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    refreshGitStatus();
  }, [load, refreshGitStatus]);

  // Yeni dosya oluştur
  const handleCreateFile = async (filePath: string, content: string) => {
    await createFile(projectId, filePath, content);
    setShowNewFile(false);
    await load();
    await refreshGitStatus();
    setSelectedFile(filePath);
  };

  // Dosya sil
  const handleDeleteFile = async () => {
    if (!deleteTarget) return;
    await deleteFile(projectId, deleteTarget);
    if (selectedFile === deleteTarget) setSelectedFile(null);
    setDeleteTarget(null);
    await load();
    await refreshGitStatus();
  };

  // Commit tamamlandı
  const handleCommitted = async () => {
    setShowCommit(false);
    await refreshGitStatus();
  };

  const totalChanges =
    gitStatus.modified.length + gitStatus.untracked.length + gitStatus.deleted.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-[#525252] animate-spin" />
      </div>
    );
  }

  if (noRepo) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <FolderTree size={32} className="text-[#333] mb-3" />
        <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">Depo Yok</h3>
        <p className="text-[12px] text-[#525252] max-w-sm">
          Proje deposu, çalışma başladığında otomatik oluşturulacak.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Modallar */}
      {showNewFile && (
        <NewFileModal
          onConfirm={handleCreateFile}
          onCancel={() => setShowNewFile(false)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          filePath={deleteTarget}
          onConfirm={handleDeleteFile}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {showCommit && (
        <CommitModal
          projectId={projectId}
          gitStatus={gitStatus}
          currentFile={selectedFile}
          onCommitted={handleCommitted}
          onCancel={() => setShowCommit(false)}
        />
      )}

      <div className="flex h-full">
        {/* Yan panel — Dosya ağacı */}
        <div className="w-[260px] shrink-0 border-r border-[#262626] flex flex-col bg-[#0d0d0d]">
          {/* Branch ve eylem çubuğu */}
          <div className="border-b border-[#262626]">
            {branches.current && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#1a1a1a]">
                <GitBranch size={12} className="text-[#22c55e]" />
                <span className="text-[11px] text-[#a3a3a3] font-mono truncate flex-1">
                  {branches.current}
                </span>
              </div>
            )}
            {/* Araç çubuğu */}
            <div className="flex items-center gap-1 px-2 py-1.5">
              {/* Yeni dosya */}
              <button
                onClick={() => setShowNewFile(true)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#525252] hover:text-[#3b82f6] hover:bg-[#3b82f6]/10 transition-colors"
                title="Yeni dosya oluştur"
              >
                <Plus size={12} />
                <span>Yeni</span>
              </button>

              <div className="flex-1" />

              {/* Git durumu yenile */}
              <button
                onClick={refreshGitStatus}
                disabled={statusRefreshing}
                className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] disabled:opacity-50 transition-colors"
                title="Git durumunu yenile"
              >
                <RefreshCw size={11} className={statusRefreshing ? 'animate-spin' : ''} />
              </button>

              {/* Commit butonu — değişiklik varsa göster */}
              {totalChanges > 0 && (
                <button
                  onClick={() => setShowCommit(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20 transition-colors"
                  title="Değişiklikleri commit et"
                >
                  <GitCommit size={11} />
                  <span>{totalChanges}</span>
                </button>
              )}
            </div>
          </div>

          {/* Dosya ağacı */}
          <div className="flex-1 overflow-y-auto py-2">
            {tree
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              })
              .map((node) => (
                <TreeNode
                  key={node.name}
                  node={node}
                  path=""
                  depth={0}
                  onSelect={setSelectedFile}
                  onDelete={(p) => setDeleteTarget(p)}
                  gitStatus={gitStatus}
                />
              ))}
          </div>

          {/* Git durum özeti */}
          {totalChanges > 0 && (
            <div className="border-t border-[#262626] px-3 py-2 space-y-0.5">
              <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">
                Degisiklikler
              </p>
              {gitStatus.modified.length > 0 && (
                <p className="text-[11px] text-[#f59e0b]">
                  M {gitStatus.modified.length} degistirildi
                </p>
              )}
              {gitStatus.untracked.length > 0 && (
                <p className="text-[11px] text-[#22c55e]">
                  U {gitStatus.untracked.length} yeni
                </p>
              )}
              {gitStatus.deleted.length > 0 && (
                <p className="text-[11px] text-[#ef4444]">
                  D {gitStatus.deleted.length} silindi
                </p>
              )}
            </div>
          )}
        </div>

        {/* İçerik alanı */}
        {selectedFile ? (
          <FileViewer
            path={selectedFile}
            projectId={projectId}
            gitStatus={gitStatus}
            onClose={() => setSelectedFile(null)}
            onCommitRequest={() => setShowCommit(true)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <FileText size={28} className="text-[#333] mx-auto mb-2" />
              <p className="text-[12px] text-[#525252]">Görüntülemek için bir dosya seçin</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
