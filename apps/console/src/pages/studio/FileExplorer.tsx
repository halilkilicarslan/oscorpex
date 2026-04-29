// ---------------------------------------------------------------------------
// Oscorpex — File Explorer (refactored)
// Extracted sub-components into file-explorer/ folder.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  FolderTree,
  FileText,
  Plus,
  RefreshCw,
  GitBranch,
  GitCommit,
} from 'lucide-react';
import {
  createFile,
  deleteFile,
  getGitStatus,
  type GitStatusResult,
} from '../../lib/studio-api';
import { httpGet } from '../../lib/studio-api/base.js';
import {
  NewFileModal,
  DeleteConfirmModal,
  CommitModal,
  TreeNode,
  FileViewer,
  type FileNode,
} from './file-explorer/index.js';

export default function FileExplorer({ projectId }: { projectId: string }) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ branches: string[]; current: string }>({
    branches: [],
    current: '',
  });
  const [noRepo, setNoRepo] = useState(false);

  const [gitStatus, setGitStatus] = useState<GitStatusResult>({
    modified: [],
    untracked: [],
    staged: [],
    deleted: [],
  });

  const [showNewFile, setShowNewFile] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showCommit, setShowCommit] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [treeRes, branchRes] = await Promise.allSettled([
        httpGet<FileNode[]>(`/api/studio/projects/${projectId}/files`),
        httpGet<{ branches: string[]; current: string }>(`/api/studio/projects/${projectId}/git/branches`),
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

  const refreshGitStatus = useCallback(async () => {
    setStatusRefreshing(true);
    try {
      const status = await getGitStatus(projectId);
      setGitStatus(status);
    } catch {
      // ignore
    } finally {
      setStatusRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    refreshGitStatus();
  }, [load, refreshGitStatus]);

  const handleCreateFile = async (filePath: string, content: string) => {
    await createFile(projectId, filePath, content);
    setShowNewFile(false);
    await load();
    await refreshGitStatus();
    setSelectedFile(filePath);
  };

  const handleDeleteFile = async () => {
    if (!deleteTarget) return;
    await deleteFile(projectId, deleteTarget);
    if (selectedFile === deleteTarget) setSelectedFile(null);
    setDeleteTarget(null);
    await load();
    await refreshGitStatus();
  };

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
        <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">No Repository</h3>
        <p className="text-[12px] text-[#525252] max-w-sm">
          The project repository will be created automatically when work begins.
        </p>
      </div>
    );
  }

  return (
    <>
      {showNewFile && (
        <NewFileModal onConfirm={handleCreateFile} onCancel={() => setShowNewFile(false)} />
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
        {/* Sidebar — File tree */}
        <div className="w-[260px] shrink-0 border-r border-[#262626] flex flex-col bg-[#0d0d0d]">
          <div className="border-b border-[#262626]">
            {branches.current && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#1a1a1a]">
                <GitBranch size={12} className="text-[#22c55e]" />
                <span className="text-[11px] text-[#a3a3a3] font-mono truncate flex-1">
                  {branches.current}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                onClick={() => setShowNewFile(true)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#525252] hover:text-[#3b82f6] hover:bg-[#3b82f6]/10 transition-colors"
                title="Create new file"
              >
                <Plus size={12} />
                <span>New</span>
              </button>

              <div className="flex-1" />

              <button
                onClick={refreshGitStatus}
                disabled={statusRefreshing}
                className="p-1 rounded text-[#525252] hover:text-[#a3a3a3] disabled:opacity-50 transition-colors"
                title="Git durumunu yenile"
              >
                <RefreshCw size={11} className={statusRefreshing ? 'animate-spin' : ''} />
              </button>

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

          {totalChanges > 0 && (
            <div className="border-t border-[#262626] px-3 py-2 space-y-0.5">
              <p className="text-[10px] text-[#525252] uppercase tracking-wider mb-1">
                Degisiklikler
              </p>
              {gitStatus.modified.length > 0 && (
                <p className="text-[11px] text-[#f59e0b]">M {gitStatus.modified.length} degistirildi</p>
              )}
              {gitStatus.untracked.length > 0 && (
                <p className="text-[11px] text-[#22c55e]">U {gitStatus.untracked.length} yeni</p>
              )}
              {gitStatus.deleted.length > 0 && (
                <p className="text-[11px] text-[#ef4444]">D {gitStatus.deleted.length} silindi</p>
              )}
            </div>
          )}
        </div>

        {/* Content area */}
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
