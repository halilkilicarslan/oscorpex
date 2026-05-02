// ---------------------------------------------------------------------------
// Oscorpex — Marketplace Repository (V6 M6 F6: Agent Marketplace)
// DB CRUD for community-shared agent configs and team templates.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { execute, query, queryOne } from "../pg.js";
const log = createLogger("marketplace-repo");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketplaceItem {
	id: string;
	type: "agent" | "template";
	name: string;
	description: string;
	author: string;
	authorId: string | null;
	category: string;
	tags: string[];
	config: Record<string, unknown>;
	downloads: number;
	rating: number;
	ratingCount: number;
	isVerified: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface MarketplaceListOpts {
	type?: "agent" | "template";
	category?: string;
	search?: string;
	tags?: string[];
	sort?: "downloads" | "rating" | "newest";
	limit?: number;
	offset?: number;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToItem(row: Record<string, unknown>): MarketplaceItem {
	return {
		id: row.id as string,
		type: row.type as "agent" | "template",
		name: row.name as string,
		description: (row.description as string) ?? "",
		author: (row.author as string) ?? "Anonymous",
		authorId: (row.author_id as string) ?? null,
		category: (row.category as string) ?? "general",
		tags: (row.tags as string[]) ?? [],
		config: (row.config as Record<string, unknown>) ?? {},
		downloads: (row.downloads as number) ?? 0,
		rating: (row.rating as number) ?? 0,
		ratingCount: (row.rating_count as number) ?? 0,
		isVerified: (row.is_verified as boolean) ?? false,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createMarketplaceItem(
	data: Omit<MarketplaceItem, "id" | "downloads" | "rating" | "ratingCount" | "isVerified" | "createdAt" | "updatedAt">,
): Promise<MarketplaceItem> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const row = await queryOne<Record<string, unknown>>(
		`INSERT INTO marketplace_items
		  (id, type, name, description, author, author_id, category, tags, config, downloads, rating, rating_count, is_verified, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,0,false,$10,$11)
		 RETURNING *`,
		[
			id,
			data.type,
			data.name,
			data.description,
			data.author,
			data.authorId ?? null,
			data.category,
			JSON.stringify(data.tags ?? []),
			JSON.stringify(data.config ?? {}),
			now,
			now,
		],
	);
	// row is always non-null after a successful INSERT RETURNING *
	// biome-ignore lint/style/noNonNullAssertion: insert always returns the row
	return rowToItem(row!);
}

export async function listMarketplaceItems(opts: MarketplaceListOpts = {}): Promise<MarketplaceItem[]> {
	const { type, category, search, tags, sort = "downloads", limit = 50, offset = 0 } = opts;
	const conditions: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (type) {
		conditions.push(`type = $${idx++}`);
		params.push(type);
	}
	if (category) {
		conditions.push(`category = $${idx++}`);
		params.push(category);
	}
	if (search) {
		conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
		params.push(`%${search}%`);
		idx++;
	}
	if (tags && tags.length > 0) {
		conditions.push(`tags @> $${idx++}::jsonb`);
		params.push(JSON.stringify(tags));
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

	const orderMap: Record<string, string> = {
		downloads: "downloads DESC",
		rating: "rating DESC, rating_count DESC",
		newest: "created_at DESC",
	};
	const orderBy = orderMap[sort] ?? "downloads DESC";

	params.push(limit, offset);
	const rows = await query<Record<string, unknown>>(
		`SELECT * FROM marketplace_items ${where} ORDER BY ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
		params,
	);
	return rows.map(rowToItem);
}

export async function getMarketplaceItem(id: string): Promise<MarketplaceItem | null> {
	const row = await queryOne<Record<string, unknown>>("SELECT * FROM marketplace_items WHERE id = $1", [id]);
	return row ? rowToItem(row) : null;
}

export async function updateMarketplaceItem(
	id: string,
	data: Partial<
		Pick<MarketplaceItem, "name" | "description" | "category" | "tags" | "config" | "isVerified" | "author">
	>,
): Promise<MarketplaceItem | null> {
	const sets: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (data.name !== undefined) {
		sets.push(`name = $${idx++}`);
		params.push(data.name);
	}
	if (data.description !== undefined) {
		sets.push(`description = $${idx++}`);
		params.push(data.description);
	}
	if (data.category !== undefined) {
		sets.push(`category = $${idx++}`);
		params.push(data.category);
	}
	if (data.tags !== undefined) {
		sets.push(`tags = $${idx++}::jsonb`);
		params.push(JSON.stringify(data.tags));
	}
	if (data.config !== undefined) {
		sets.push(`config = $${idx++}::jsonb`);
		params.push(JSON.stringify(data.config));
	}
	if (data.isVerified !== undefined) {
		sets.push(`is_verified = $${idx++}`);
		params.push(data.isVerified);
	}
	if (data.author !== undefined) {
		sets.push(`author = $${idx++}`);
		params.push(data.author);
	}

	if (sets.length === 0) return getMarketplaceItem(id);

	sets.push(`updated_at = $${idx++}`);
	params.push(new Date().toISOString());
	params.push(id);

	const row = await queryOne<Record<string, unknown>>(
		`UPDATE marketplace_items SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
		params,
	);
	return row ? rowToItem(row) : null;
}

export async function deleteMarketplaceItem(id: string): Promise<boolean> {
	const result = await execute("DELETE FROM marketplace_items WHERE id = $1", [id]);
	return (result as unknown as { rowCount: number }).rowCount > 0;
}

export async function incrementDownloads(id: string): Promise<MarketplaceItem | null> {
	const row = await queryOne<Record<string, unknown>>(
		"UPDATE marketplace_items SET downloads = downloads + 1, updated_at = $1 WHERE id = $2 RETURNING *",
		[new Date().toISOString(), id],
	);
	return row ? rowToItem(row) : null;
}

/**
 * Update weighted average rating.
 * new_avg = (old_avg * old_count + new_rating) / (old_count + 1)
 */
export async function rateMarketplaceItem(id: string, rating: number): Promise<MarketplaceItem | null> {
	const row = await queryOne<Record<string, unknown>>(
		`UPDATE marketplace_items
		 SET rating       = (rating * rating_count + $1) / (rating_count + 1),
		     rating_count = rating_count + 1,
		     updated_at   = $2
		 WHERE id = $3
		 RETURNING *`,
		[rating, new Date().toISOString(), id],
	);
	return row ? rowToItem(row) : null;
}

export async function countMarketplaceItems(
	opts: Omit<MarketplaceListOpts, "sort" | "limit" | "offset"> = {},
): Promise<number> {
	const { type, category, search, tags } = opts;
	const conditions: string[] = [];
	const params: unknown[] = [];
	let idx = 1;

	if (type) {
		conditions.push(`type = $${idx++}`);
		params.push(type);
	}
	if (category) {
		conditions.push(`category = $${idx++}`);
		params.push(category);
	}
	if (search) {
		conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
		params.push(`%${search}%`);
		idx++;
	}
	if (tags && tags.length > 0) {
		conditions.push(`tags @> $${idx++}::jsonb`);
		params.push(JSON.stringify(tags));
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const row = await queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM marketplace_items ${where}`, params);
	return Number(row?.count ?? 0);
}
