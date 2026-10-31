// ---------------------------------------------------------------------------
// Operator command: grant / revoke the platform-admin flag (users.is_platform_admin).
//
// The runtime role cannot write this column; the command connects with the migration
// URL (OSCORPEX_MIGRATION_DATABASE_URL). Outside production it falls back to DATABASE_URL.
//
// Library only; the CLI entry is src/bin/admin-grant.ts.
//   pnpm --filter @oscorpex/kernel admin:grant  user@example.com
//   pnpm --filter @oscorpex/kernel admin:revoke user@example.com
//   node dist/admin-grant.js grant|revoke user@example.com   (production image)
// ---------------------------------------------------------------------------

import pg from "pg";
import { redactConnectionStrings } from "../src/studio/redact-secrets.js";

export interface AdminGrantOptions {
	/** Overrides OSCORPEX_MIGRATION_DATABASE_URL / DATABASE_URL. */
	migrationUrl?: string;
}

function resolveUrl(opts: AdminGrantOptions): string {
	const explicit = (opts.migrationUrl ?? process.env.OSCORPEX_MIGRATION_DATABASE_URL)?.trim();
	if (explicit) return explicit;
	if (process.env.NODE_ENV === "production") {
		throw new Error("OSCORPEX_MIGRATION_DATABASE_URL is required in production");
	}
	const fallback = process.env.DATABASE_URL?.trim();
	if (!fallback) throw new Error("OSCORPEX_MIGRATION_DATABASE_URL (or DATABASE_URL outside production) is not set");
	return fallback;
}

async function setFlag(email: string, value: boolean, opts: AdminGrantOptions): Promise<void> {
	if (typeof email !== "string" || email.length === 0) throw new Error("email is required");
	const client = new pg.Client({ connectionString: resolveUrl(opts) });
	await client.connect();
	try {
		const res = await client.query("UPDATE users SET is_platform_admin = $2 WHERE email = $1", [email, value]);
		if ((res.rowCount ?? 0) === 0) throw new Error(`No user with email ${email}`);
	} finally {
		await client.end();
	}
}

export function grantPlatformAdmin(email: string, opts: AdminGrantOptions = {}): Promise<void> {
	return setFlag(email, true, opts);
}

export function revokePlatformAdmin(email: string, opts: AdminGrantOptions = {}): Promise<void> {
	return setFlag(email, false, opts);
}

/** CLI runner: parses argv, applies the flag, sets the exit code on failure. */
export async function runAdminGrantCli(): Promise<void> {
	const [action, email] = process.argv.slice(2);
	if ((action !== "grant" && action !== "revoke") || !email) {
		console.error("Usage: admin-grant <grant|revoke> <email>");
		process.exit(2);
	}
	try {
		if (action === "grant") await grantPlatformAdmin(email);
		else await revokePlatformAdmin(email);
		console.log(`${action === "grant" ? "Granted" : "Revoked"} platform admin: ${email}`);
	} catch (err) {
		console.error(redactConnectionStrings(String(err instanceof Error ? err.message : err)));
		process.exit(1);
	}
}
