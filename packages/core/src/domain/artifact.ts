// @oscorpex/core — Artifact manifest domain type

export interface ArtifactManifest {
	taskId: string;
	filesCreated: string[];
	filesModified: string[];
	logs?: string[];
	diffRefs?: string[];
}