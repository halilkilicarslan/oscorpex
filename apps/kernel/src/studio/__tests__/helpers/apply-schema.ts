// ---------------------------------------------------------------------------
// Typed access to db-bootstrap.applySchema (imported lazily so a missing export
// fails the calling test, not the whole file).
// ---------------------------------------------------------------------------

import { expect } from "vitest";

export type ApplyReason = "forced" | "changed" | "drift" | "unchanged";
export interface ApplyResult {
	applied: boolean;
	reason: ApplyReason;
}
export interface ApplyOptions {
	migrationUrl?: string;
	runtimeUrl?: string;
	force?: boolean;
}

export async function runApplySchema(opts?: ApplyOptions): Promise<ApplyResult> {
	const mod = (await import("../../db-bootstrap.js")) as unknown as {
		applySchema?: (o?: ApplyOptions) => Promise<ApplyResult>;
	};
	expect(typeof mod.applySchema, "db-bootstrap must export applySchema").toBe("function");
	return (mod.applySchema as NonNullable<typeof mod.applySchema>)(opts);
}

export interface RuntimeIsolationInfo {
	runtimeUser: string;
	migratorUser: string;
	rolsuper: boolean;
	rolbypassrls: boolean;
	memberOf: string[];
}
export interface BootstrapExports {
	prepareSchemaSql: (rawSql: string, opts: { hasVector: boolean }) => string;
	schemaHash: (sql: string) => string;
	checkRuntimeIsolation: (
		info: RuntimeIsolationInfo,
		env: { production: boolean },
	) => { fatal: string[]; warnings: string[] };
}

export async function loadBootstrap(): Promise<BootstrapExports> {
	const mod = (await import("../../db-bootstrap.js")) as unknown as Partial<BootstrapExports>;
	for (const name of ["prepareSchemaSql", "schemaHash", "checkRuntimeIsolation"] as const) {
		expect(typeof mod[name], `db-bootstrap must export ${name}`).toBe("function");
	}
	return mod as BootstrapExports;
}
