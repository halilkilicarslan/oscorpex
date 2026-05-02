// ---------------------------------------------------------------------------
// Oscorpex — CI Tracker (V6 M3)
// GitHub / GitLab CI durumunu webhook + polling ile takip eden servis.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
	type CIProvider,
	type CIStatus,
	type CITracking,
	createCITracking,
	getCITrackings,
	updateCITracking,
} from "./db/ci-repo.js";
import { createLogger } from "./logger.js";
const log = createLogger("ci-tracker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackPROptions {
	projectId: string;
	provider: CIProvider;
	prId: string;
	prUrl?: string;
	pipelineUrl?: string;
}

export interface TrackPRResult {
	trackingId: string;
	tracking: CITracking;
}

// GitHub webhook payloads (check_run / check_suite)
interface GitHubCheckRunPayload {
	action?: string;
	check_run?: {
		id?: number;
		name?: string;
		status?: string; // queued | in_progress | completed
		conclusion?: string | null; // success | failure | cancelled | neutral | …
		html_url?: string;
		pull_requests?: Array<{ number: number; head: { sha: string } }>;
	};
	repository?: { full_name?: string };
	installation?: { id?: number };
}

interface GitHubCheckSuitePayload {
	action?: string;
	check_suite?: {
		id?: number;
		status?: string;
		conclusion?: string | null;
		pull_requests?: Array<{ number: number }>;
	};
	repository?: { full_name?: string };
}

// GitLab pipeline webhook payload
interface GitLabPipelinePayload {
	object_kind?: string;
	pipeline_id?: number;
	object_attributes?: {
		id?: number;
		ref?: string;
		status?: string; // pending | running | success | failed | canceled | skipped
		web_url?: string;
	};
	project?: { id?: number; web_url?: string };
	merge_request?: { iid?: number };
}

export type GitHubWebhookPayload = GitHubCheckRunPayload | GitHubCheckSuitePayload | Record<string, unknown>;
export type GitLabWebhookPayload = GitLabPipelinePayload | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Status normalisation helpers
// ---------------------------------------------------------------------------

function normaliseGitHubStatus(status: string, conclusion: string | null | undefined): CIStatus {
	if (status === "queued") return "pending";
	if (status === "in_progress") return "running";
	if (status === "completed") {
		if (!conclusion) return "success";
		if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") return "success";
		if (conclusion === "cancelled" || conclusion === "timed_out") return "cancelled";
		return "failure";
	}
	return "pending";
}

function normaliseGitLabStatus(status: string): CIStatus {
	switch (status) {
		case "created":
		case "waiting_for_resource":
		case "preparing":
		case "pending":
		case "manual":
		case "scheduled":
			return "pending";
		case "running":
			return "running";
		case "success":
			return "success";
		case "failed":
			return "failure";
		case "canceled":
		case "skipped":
			return "cancelled";
		default:
			return "pending";
	}
}

// ---------------------------------------------------------------------------
// CITracker
// ---------------------------------------------------------------------------

export class CITracker {
	// ---------------------------------------------------------------------------
	// trackPR — Begin tracking a GitHub PR or GitLab MR
	// ---------------------------------------------------------------------------

	async trackPR(opts: TrackPROptions): Promise<TrackPRResult> {
		const tracking = await createCITracking({
			projectId: opts.projectId,
			provider: opts.provider,
			prId: opts.prId,
			prUrl: opts.prUrl ?? null,
			pipelineUrl: opts.pipelineUrl ?? null,
			status: "pending",
			details: {},
		});

		return { trackingId: tracking.id, tracking };
	}

	// ---------------------------------------------------------------------------
	// updateStatus — Manual or programmatic status update
	// ---------------------------------------------------------------------------

	async updateStatus(
		trackingId: string,
		status: CIStatus,
		details: Record<string, unknown> = {},
		pipelineUrl?: string,
	): Promise<CITracking> {
		return updateCITracking(trackingId, {
			status,
			details,
			...(pipelineUrl !== undefined ? { pipelineUrl } : {}),
		});
	}

	// ---------------------------------------------------------------------------
	// getTrackingStatus — All tracked PRs for a project
	// ---------------------------------------------------------------------------

	async getTrackingStatus(projectId: string): Promise<CITracking[]> {
		return getCITrackings(projectId);
	}

	// ---------------------------------------------------------------------------
	// processWebhook — Parse provider webhook and update relevant trackings
	// ---------------------------------------------------------------------------

	/**
	 * Process an incoming webhook payload from GitHub or GitLab.
	 * Matches against all ci_trackings rows for the given project.
	 *
	 * Returns the updated tracking if a match is found, null otherwise.
	 */
	async processWebhook(
		provider: CIProvider,
		payload: GitHubWebhookPayload | GitLabWebhookPayload,
		projectId?: string,
	): Promise<CITracking | null> {
		if (provider === "github") {
			return this._processGitHubWebhook(payload as GitHubWebhookPayload, projectId);
		}
		return this._processGitLabWebhook(payload as GitLabWebhookPayload, projectId);
	}

	// ---------------------------------------------------------------------------
	// Internal — GitHub webhook processing
	// ---------------------------------------------------------------------------

	private async _processGitHubWebhook(
		payload: GitHubWebhookPayload,
		projectId?: string,
	): Promise<CITracking | null> {
		const p = payload as Record<string, unknown>;

		// check_run event
		if (p.check_run && typeof p.check_run === "object") {
			const cr = p.check_run as Record<string, unknown>;
			const status = normaliseGitHubStatus(
				String(cr.status ?? "queued"),
				(cr.conclusion as string | null) ?? null,
			);
			const pipelineUrl = (cr.html_url as string | undefined) ?? undefined;

			// Find the PR number from check_run.pull_requests
			const pullRequests = (cr.pull_requests as Array<{ number: number }> | undefined) ?? [];
			if (pullRequests.length > 0) {
				const prNumber = String(pullRequests[0].number);
				return this._matchAndUpdate("github", prNumber, status, { check_run: cr }, pipelineUrl, projectId);
			}
			return null;
		}

		// check_suite event
		if (p.check_suite && typeof p.check_suite === "object") {
			const cs = p.check_suite as Record<string, unknown>;
			const status = normaliseGitHubStatus(
				String(cs.status ?? "queued"),
				(cs.conclusion as string | null) ?? null,
			);
			const pullRequests = (cs.pull_requests as Array<{ number: number }> | undefined) ?? [];
			if (pullRequests.length > 0) {
				const prNumber = String(pullRequests[0].number);
				return this._matchAndUpdate("github", prNumber, status, { check_suite: cs }, undefined, projectId);
			}
			return null;
		}

		return null;
	}

	// ---------------------------------------------------------------------------
	// Internal — GitLab webhook processing
	// ---------------------------------------------------------------------------

	private async _processGitLabWebhook(
		payload: GitLabWebhookPayload,
		projectId?: string,
	): Promise<CITracking | null> {
		const p = payload as Record<string, unknown>;

		if (p.object_kind !== "pipeline") return null;

		const oa = (p.object_attributes as Record<string, unknown> | undefined) ?? {};
		const rawStatus = String(oa.status ?? "pending");
		const status = normaliseGitLabStatus(rawStatus);
		const pipelineUrl = (oa.web_url as string | undefined) ?? undefined;
		const pipelineId = oa.id !== undefined ? String(oa.id) : undefined;

		// Try to resolve the MR iid
		const mr = (p.merge_request as Record<string, unknown> | undefined) ?? {};
		const mrIid = mr.iid !== undefined ? String(mr.iid) : pipelineId;

		if (!mrIid) return null;

		return this._matchAndUpdate("gitlab", mrIid, status, { pipeline: oa }, pipelineUrl, projectId);
	}

	// ---------------------------------------------------------------------------
	// Internal — find tracking row matching (provider + prId) and update
	// ---------------------------------------------------------------------------

	private async _matchAndUpdate(
		provider: CIProvider,
		prId: string,
		status: CIStatus,
		details: Record<string, unknown>,
		pipelineUrl: string | undefined,
		projectId: string | undefined,
	): Promise<CITracking | null> {
		// We need all trackings for the project (or a broader search if no projectId given)
		// For simplicity, require projectId from caller; if absent, cannot narrow.
		if (!projectId) return null;

		const all = await getCITrackings(projectId);
		const match = all.find((t) => t.provider === provider && t.prId === prId);
		if (!match) return null;

		return updateCITracking(match.id, {
			status,
			details,
			...(pipelineUrl !== undefined ? { pipelineUrl } : {}),
		});
	}
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const ciTracker = new CITracker();
