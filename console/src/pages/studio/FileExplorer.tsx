import { useState, useEffect } from 'react';
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
  Copy,
  Check,
} from 'lucide-react';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// ---------------------------------------------------------------------------
// File icon helper
// ---------------------------------------------------------------------------

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'css', 'scss', 'html', 'json', 'yaml', 'yml', 'toml'];
  if (codeExts.includes(ext)) return <FileCode size={14} className="text-[#3b82f6]" />;
  return <FileText size={14} className="text-[#737373]" />;
}

// ---------------------------------------------------------------------------
// Tree node
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  path,
  depth,
  onSelect,
}: {
  node: FileNode;
  path: string;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const fullPath = path ? `${path}/${node.name}` : node.name;
  const isDir = node.type === 'directory';

  return (
    <div>
      <button
        onClick={() => {
          if (isDir) setExpanded(!expanded);
          else onSelect(fullPath);
        }}
        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-[#1f1f1f] rounded text-left transition-colors"
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
        <span className="text-[12px] text-[#d4d4d4] truncate">{node.name}</span>
      </button>

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
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File viewer
// ---------------------------------------------------------------------------

function FileViewer({
  path,
  projectId,
  onClose,
}: {
  path: string;
  projectId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/studio/projects/${projectId}/files/${path}`)
      .then((r) => r.json())
      .then((data) => setContent(data.content ?? 'Unable to read file'))
      .catch(() => setContent('Error loading file'))
      .finally(() => setLoading(false));
  }, [path, projectId]);

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* File header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#262626] bg-[#0d0d0d]">
        <span className="text-[12px] text-[#a3a3a3] font-mono truncate">{path}</span>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={16} className="text-[#525252] animate-spin" />
        </div>
      ) : (
        <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed text-[#d4d4d4] font-mono bg-[#0a0a0a]">
          {content}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
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

  useEffect(() => {
    const load = async () => {
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
        } else {
          setNoRepo(true);
        }

        if (branchRes.status === 'fulfilled') {
          setBranches(branchRes.value);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId]);

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
          The project repository will be created when execution begins.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar — File tree */}
      <div className="w-[260px] shrink-0 border-r border-[#262626] flex flex-col bg-[#0d0d0d]">
        {/* Branch info */}
        {branches.current && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#262626]">
            <GitBranch size={12} className="text-[#22c55e]" />
            <span className="text-[11px] text-[#a3a3a3] font-mono truncate">{branches.current}</span>
          </div>
        )}

        {/* Tree */}
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
              />
            ))}
        </div>
      </div>

      {/* Content */}
      {selectedFile ? (
        <FileViewer
          path={selectedFile}
          projectId={projectId}
          onClose={() => setSelectedFile(null)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-center">
          <div>
            <FileText size={28} className="text-[#333] mx-auto mb-2" />
            <p className="text-[12px] text-[#525252]">Select a file to view</p>
          </div>
        </div>
      )}
    </div>
  );
}
