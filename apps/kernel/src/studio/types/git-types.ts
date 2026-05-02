// ---------------------------------------------------------------------------
// Oscorpex — Git Types
// ---------------------------------------------------------------------------

export interface GitLogEntry {
	hash: string;
	message: string;
	author: string;
	date: string;
}

export interface FileTreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: FileTreeNode[];
}

export interface MergeResult {
	success: boolean;
	conflicts?: string[];
}

export interface GitStatus {
	modified: string[];
	untracked: string[];
	staged: string[];
	deleted: string[];
}
