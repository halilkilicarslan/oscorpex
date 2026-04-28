// ---------------------------------------------------------------------------
// Tree Node
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Trash2, Circle } from 'lucide-react';
import type { GitStatusResult } from '../../../lib/studio-api';
import type { FileNode } from './types.js';
import { getFileIcon } from './helpers.js';

interface TreeNodeProps {
  node: FileNode;
  path: string;
  depth: number;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  gitStatus: GitStatusResult;
}

export default function TreeNode({ node, path, depth, onSelect, onDelete, gitStatus }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [hovered, setHovered] = useState(false);
  const fullPath = path ? `${path}/${node.name}` : node.name;
  const isDir = node.type === 'directory';

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
