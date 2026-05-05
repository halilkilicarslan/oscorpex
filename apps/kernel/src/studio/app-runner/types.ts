// ---------------------------------------------------------------------------
// app-runner/types.ts — Shared types
// ---------------------------------------------------------------------------

import type { ChildProcess } from "node:child_process";

export interface ServiceConfig {
	name: string;
	path: string; // relative to repoPath
	command: string; // start command (${PORT} placeholder)
	port: number;
	readyPattern: string; // regex to detect server ready
	env?: Record<string, string>;
}

export interface StudioConfig {
	services: ServiceConfig[];
	preview: string; // service name to show in preview iframe
}

export interface RunningService {
	name: string;
	process: ChildProcess;
	port: number;
	url: string;
}

export interface AppRunnerStatus {
	running: boolean;
	services: { name: string; url: string; isPreview: boolean }[];
	previewUrl: string | null;
	// backward compat
	backendUrl: string | null;
	frontendUrl: string | null;
}

export interface LangDetection {
	name: string;
	path: string;
	command: string;
	readyPattern: string;
	type: "backend" | "frontend" | "fullstack";
}
