// ---------------------------------------------------------------------------
// Oscorpex — Marketplace API Client (V6 M6 F6: Agent Marketplace)
// ---------------------------------------------------------------------------

import { API, json } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketplaceItem {
	id: string;
	type: 'agent' | 'template';
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
	type?: 'agent' | 'template';
	category?: string;
	search?: string;
	tags?: string[];
	sort?: 'downloads' | 'rating' | 'newest';
	limit?: number;
	offset?: number;
}

export interface PublishMarketplaceItemData {
	type: 'agent' | 'template';
	name: string;
	description?: string;
	author?: string;
	authorId?: string;
	category?: string;
	tags?: string[];
	config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchMarketplaceItems(opts: MarketplaceListOpts = {}): Promise<MarketplaceItem[]> {
	const params = new URLSearchParams();
	if (opts.type) params.set('type', opts.type);
	if (opts.category) params.set('category', opts.category);
	if (opts.search) params.set('search', opts.search);
	if (opts.tags && opts.tags.length > 0) params.set('tags', opts.tags.join(','));
	if (opts.sort) params.set('sort', opts.sort);
	if (opts.limit != null) params.set('limit', String(opts.limit));
	if (opts.offset != null) params.set('offset', String(opts.offset));
	const qs = params.toString() ? `?${params.toString()}` : '';
	return json<MarketplaceItem[]>(`${API}/marketplace${qs}`);
}

export async function fetchMarketplaceItem(id: string): Promise<MarketplaceItem> {
	return json<MarketplaceItem>(`${API}/marketplace/${id}`);
}

export async function publishMarketplaceItem(data: PublishMarketplaceItemData): Promise<MarketplaceItem> {
	return json<MarketplaceItem>(`${API}/marketplace`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

export async function updateMarketplaceItem(
	id: string,
	data: Partial<PublishMarketplaceItemData>,
): Promise<MarketplaceItem> {
	return json<MarketplaceItem>(`${API}/marketplace/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
}

export async function deleteMarketplaceItemApi(id: string): Promise<void> {
	await json<{ ok: boolean }>(`${API}/marketplace/${id}`, { method: 'DELETE' });
}

export async function downloadMarketplaceItem(id: string): Promise<{ ok: boolean; config: Record<string, unknown>; item: MarketplaceItem }> {
	return json<{ ok: boolean; config: Record<string, unknown>; item: MarketplaceItem }>(
		`${API}/marketplace/${id}/download`,
		{ method: 'POST' },
	);
}

export async function rateMarketplaceItem(id: string, rating: number): Promise<{ ok: boolean; rating: number; ratingCount: number }> {
	return json<{ ok: boolean; rating: number; ratingCount: number }>(
		`${API}/marketplace/${id}/rate`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ rating }),
		},
	);
}
