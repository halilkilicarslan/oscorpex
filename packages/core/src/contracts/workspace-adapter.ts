// @oscorpex/core — WorkspaceAdapter contract
// Interface for managing workspace (repo) preparation and cleanup.

export interface WorkspaceStatus {
	path: string;
	ready: boolean;
	clean: boolean;
	branch?: string;
	uncommittedFiles?: string[];
}

export interface WorkspaceConfig {
	branch?: string;
	cleanOnPrepare?: boolean;
	Env?: Record<string, string>;
}

export interface WorkspaceAdapter {
	prepare(repoPath: string, config?: WorkspaceConfig): Promise<string>;
	cleanup(repoPath: string): Promise<void>;
	getStatus(repoPath: string): Promise<WorkspaceStatus>;
}