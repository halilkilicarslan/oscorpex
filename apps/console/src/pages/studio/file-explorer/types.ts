// ---------------------------------------------------------------------------
// File Explorer Types
// ---------------------------------------------------------------------------

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: FileNode[];
}
