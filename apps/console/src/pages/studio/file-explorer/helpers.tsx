// ---------------------------------------------------------------------------
// File Explorer Helpers
// ---------------------------------------------------------------------------

import { FileText, FileCode } from 'lucide-react';

export function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'css', 'scss', 'html', 'json', 'yaml', 'yml', 'toml'];
  if (codeExts.includes(ext)) return <FileCode size={14} className="text-[#3b82f6]" />;
  return <FileText size={14} className="text-[#737373]" />;
}
