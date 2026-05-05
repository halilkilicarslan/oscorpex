// ---------------------------------------------------------------------------
// app-runner/port-manager.ts — Port conflict detection and resolution
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

/** Ports reserved for Oscorpex core services — agents must never bind to these */
export const RESERVED_PORTS = new Set([5173, 4242, 3141, 3142]);

export function isPortInUse(port: number): boolean {
	try {
		execFileSync("lsof", ["-ti", `:${port}`], { stdio: "pipe", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

export function resolvePort(desiredPort: number, usedPorts: Set<number>): number {
	let port = desiredPort;
	while (usedPorts.has(port) || RESERVED_PORTS.has(port) || isPortInUse(port)) {
		port++;
	}
	return port;
}

export async function postStartHealthCheck(port: number, maxRetries = 5): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
			// Herhangi bir HTTP response (404 dahil) = process çalışıyor
			return true;
		} catch {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	return false;
}
