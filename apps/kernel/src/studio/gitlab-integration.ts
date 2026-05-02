// ---------------------------------------------------------------------------
// Oscorpex — GitLab Integration (V6 M3)
// Native fetch tabanlı GitLab API client — MR oluşturma, pipeline takibi.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitLabMR {
	id: number;
	iid: number;
	projectId: number;
	title: string;
	description: string;
	state: "opened" | "closed" | "locked" | "merged";
	webUrl: string;
	sourceBranch: string;
	targetBranch: string;
	createdAt: string;
	updatedAt: string;
	mergeStatus: string | null;
	sha: string | null;
	author: { id: number; username: string; name: string } | null;
}

export interface GitLabPipeline {
	id: number;
	projectId: number;
	ref: string;
	sha: string;
	status:
		| "created"
		| "waiting_for_resource"
		| "preparing"
		| "pending"
		| "running"
		| "success"
		| "failed"
		| "canceled"
		| "skipped"
		| "manual"
		| "scheduled";
	webUrl: string;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface CreateMROptions {
	sourceBranch: string;
	targetBranch: string;
	title: string;
	description?: string;
	removeSourceBranch?: boolean;
	squash?: boolean;
	assigneeIds?: number[];
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapMR(raw: Record<string, unknown>): GitLabMR {
	return {
		id: raw.id as number,
		iid: raw.iid as number,
		projectId: raw.project_id as number,
		title: raw.title as string,
		description: (raw.description as string) ?? "",
		state: raw.state as GitLabMR["state"],
		webUrl: raw.web_url as string,
		sourceBranch: raw.source_branch as string,
		targetBranch: raw.target_branch as string,
		createdAt: raw.created_at as string,
		updatedAt: raw.updated_at as string,
		mergeStatus: (raw.merge_status as string | null) ?? null,
		sha: (raw.sha as string | null) ?? null,
		author: raw.author
			? {
					id: (raw.author as Record<string, unknown>).id as number,
					username: (raw.author as Record<string, unknown>).username as string,
					name: (raw.author as Record<string, unknown>).name as string,
				}
			: null,
	};
}

function mapPipeline(raw: Record<string, unknown>): GitLabPipeline {
	return {
		id: raw.id as number,
		projectId: raw.project_id as number,
		ref: raw.ref as string,
		sha: raw.sha as string,
		status: raw.status as GitLabPipeline["status"],
		webUrl: raw.web_url as string,
		createdAt: raw.created_at as string,
		updatedAt: raw.updated_at as string,
		startedAt: (raw.started_at as string | null) ?? null,
		finishedAt: (raw.finished_at as string | null) ?? null,
	};
}

// ---------------------------------------------------------------------------
// GitLabClient
// ---------------------------------------------------------------------------

export class GitLabClient {
	private baseUrl: string;
	private privateToken: string;

	/**
	 * @param baseUrl      GitLab instance URL, e.g. "https://gitlab.com"
	 * @param privateToken Personal access token or project/group token
	 */
	constructor(baseUrl: string, privateToken: string) {
		// Normalize — remove trailing slash
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.privateToken = privateToken;
	}

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	private url(path: string): string {
		return `${this.baseUrl}/api/v4${path}`;
	}

	private headers(): Record<string, string> {
		return {
			"PRIVATE-TOKEN": this.privateToken,
			"Content-Type": "application/json",
		};
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(this.url(path), {
			method,
			headers: this.headers(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});

		if (!res.ok) {
			let errorMsg = `GitLab API ${method} ${path} failed: HTTP ${res.status}`;
			try {
				const errBody = (await res.json()) as Record<string, unknown>;
				const msg = errBody.message ?? errBody.error ?? errBody.error_description;
				if (msg) errorMsg = `${errorMsg} — ${String(msg)}`;
			} catch {
				// ignore JSON parse failure
			}
			throw new Error(errorMsg);
		}

		return res.json() as Promise<T>;
	}

	// ---------------------------------------------------------------------------
	// Merge Requests
	// ---------------------------------------------------------------------------

	/**
	 * Create a merge request in the given project.
	 * @param projectId GitLab project ID (numeric) or URL-encoded path
	 */
	async createMergeRequest(
		projectId: string | number,
		sourceBranch: string,
		targetBranch: string,
		title: string,
		description = "",
		opts: Omit<CreateMROptions, "sourceBranch" | "targetBranch" | "title" | "description"> = {},
	): Promise<GitLabMR> {
		const body: Record<string, unknown> = {
			source_branch: sourceBranch,
			target_branch: targetBranch,
			title,
			description,
			remove_source_branch: opts.removeSourceBranch ?? false,
			squash: opts.squash ?? false,
		};
		if (opts.assigneeIds?.length) body.assignee_ids = opts.assigneeIds;

		const raw = await this.request<Record<string, unknown>>(
			"POST",
			`/projects/${encodeURIComponent(String(projectId))}/merge_requests`,
			body,
		);
		return mapMR(raw);
	}

	/**
	 * Get a single merge request by its IID (project-level sequential ID).
	 */
	async getMergeRequestStatus(projectId: string | number, mrIid: number): Promise<GitLabMR> {
		const raw = await this.request<Record<string, unknown>>(
			"GET",
			`/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}`,
		);
		return mapMR(raw);
	}

	/**
	 * List pipelines for a project, optionally filtered by ref (branch/tag).
	 */
	async listPipelines(projectId: string | number, ref?: string): Promise<GitLabPipeline[]> {
		const qs = ref ? `?ref=${encodeURIComponent(ref)}&per_page=20` : "?per_page=20";
		const raw = await this.request<Record<string, unknown>[]>(
			"GET",
			`/projects/${encodeURIComponent(String(projectId))}/pipelines${qs}`,
		);
		return raw.map(mapPipeline);
	}

	/**
	 * Get the status of a single pipeline by its ID.
	 */
	async getPipelineStatus(projectId: string | number, pipelineId: number): Promise<GitLabPipeline> {
		const raw = await this.request<Record<string, unknown>>(
			"GET",
			`/projects/${encodeURIComponent(String(projectId))}/pipelines/${pipelineId}`,
		);
		return mapPipeline(raw);
	}

	// ---------------------------------------------------------------------------
	// Utility — parse GitLab remote URL
	// ---------------------------------------------------------------------------

	/**
	 * Parse a GitLab remote URL into { host, projectPath }.
	 * Returns null for non-GitLab remotes.
	 *
	 * SSH:   git@gitlab.com:group/project.git
	 * HTTPS: https://gitlab.com/group/project.git
	 */
	static parseRemoteUrl(remoteUrl: string): { host: string; projectPath: string } | null {
		const trimmed = remoteUrl.trim();

		// SSH
		const sshMatch = trimmed.match(/git@([^:]+):(.+?)(?:\.git)?$/);
		if (sshMatch) {
			return { host: `https://${sshMatch[1]}`, projectPath: sshMatch[2] };
		}

		// HTTPS
		const httpsMatch = trimmed.match(/https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
		if (httpsMatch) {
			return { host: `https://${httpsMatch[1]}`, projectPath: httpsMatch[2] };
		}

		return null;
	}
}
