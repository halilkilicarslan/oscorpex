import { useState, useEffect, useCallback } from 'react';
import {
	fetchMarketplaceItems,
	downloadMarketplaceItem,
	rateMarketplaceItem,
	type MarketplaceItem,
	type MarketplaceListOpts,
} from '../../lib/studio-api/marketplace.js';

// ---------------------------------------------------------------------------
// Star Rating Component
// ---------------------------------------------------------------------------

function StarRating({ rating, count }: { rating: number; count: number }) {
	const full = Math.floor(rating);
	const half = rating - full >= 0.5;
	return (
		<span className="flex items-center gap-1 text-xs text-gray-400">
			{Array.from({ length: 5 }, (_, i) => (
				<span
					key={i}
					className={
						i < full
							? 'text-yellow-400'
							: i === full && half
								? 'text-yellow-300'
								: 'text-gray-600'
					}
				>
					&#9733;
				</span>
			))}
			<span className="ml-1">
				{rating > 0 ? rating.toFixed(1) : 'No ratings'} ({count})
			</span>
		</span>
	);
}

// ---------------------------------------------------------------------------
// Category Badge
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
	general: 'bg-gray-700 text-gray-300',
	frontend: 'bg-blue-900 text-blue-300',
	backend: 'bg-purple-900 text-purple-300',
	fullstack: 'bg-indigo-900 text-indigo-300',
	devops: 'bg-orange-900 text-orange-300',
	security: 'bg-red-900 text-red-300',
	ml: 'bg-green-900 text-green-300',
	mobile: 'bg-pink-900 text-pink-300',
};

function CategoryBadge({ category }: { category: string }) {
	const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;
	return (
		<span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${color}`}>
			{category}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Marketplace Card
// ---------------------------------------------------------------------------

function MarketplaceCard({
	item,
	onInstall,
	onRate,
}: {
	item: MarketplaceItem;
	onInstall: (item: MarketplaceItem) => Promise<void>;
	onRate: (item: MarketplaceItem, rating: number) => Promise<void>;
}) {
	const [installing, setInstalling] = useState(false);
	const [installed, setInstalled] = useState(false);
	const [hoverRating, setHoverRating] = useState(0);

	const handleInstall = async () => {
		setInstalling(true);
		try {
			await onInstall(item);
			setInstalled(true);
		} finally {
			setInstalling(false);
		}
	};

	return (
		<div
			className="flex flex-col gap-3 rounded-lg border border-[#262626] bg-[#111111] p-4 hover:border-[#363636] transition-colors"
			data-testid="marketplace-card"
		>
			{/* Header */}
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<h3 className="text-sm font-semibold text-white truncate">{item.name}</h3>
						{item.isVerified && (
							<span className="text-xs text-[#22c55e] font-medium" title="Verified">
								Verified
							</span>
						)}
					</div>
					<p className="text-xs text-gray-400 mt-0.5">by {item.author}</p>
				</div>
				<span className="text-xs px-2 py-0.5 rounded bg-[#1a1a1a] text-gray-400 capitalize shrink-0 border border-[#262626]">
					{item.type}
				</span>
			</div>

			{/* Description */}
			<p className="text-xs text-gray-400 leading-relaxed line-clamp-2 flex-1">
				{item.description || 'No description provided.'}
			</p>

			{/* Category + Tags */}
			<div className="flex flex-wrap gap-1.5 items-center">
				<CategoryBadge category={item.category} />
				{item.tags.slice(0, 3).map((tag) => (
					<span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-[#1a1a1a] text-gray-500 border border-[#262626]">
						{tag}
					</span>
				))}
			</div>

			{/* Rating */}
			<StarRating rating={item.rating} count={item.ratingCount} />

			{/* Interactive star rating */}
			<div className="flex items-center gap-0.5" aria-label="Rate this item">
				{Array.from({ length: 5 }, (_, i) => i + 1).map((star) => (
					<button
						key={star}
						data-testid={`rate-star-${star}`}
						className={`text-lg transition-colors ${star <= hoverRating ? 'text-yellow-400' : 'text-gray-700 hover:text-yellow-400'}`}
						onMouseEnter={() => setHoverRating(star)}
						onMouseLeave={() => setHoverRating(0)}
						onClick={() => onRate(item, star)}
						aria-label={`Rate ${star} star`}
					>
						&#9733;
					</button>
				))}
				<span className="ml-1 text-xs text-gray-600">Rate</span>
			</div>

			{/* Footer: downloads + install */}
			<div className="flex items-center justify-between pt-1 border-t border-[#1e1e1e]">
				<span className="text-xs text-gray-500">
					{item.downloads.toLocaleString()} installs
				</span>
				<button
					onClick={handleInstall}
					disabled={installing}
					data-testid="install-button"
					className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
						installed
							? 'bg-[#1a3a1a] text-[#22c55e] border border-[#22c55e]/30 cursor-default'
							: 'bg-[#22c55e] text-black hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed'
					}`}
				>
					{installing ? 'Installing...' : installed ? 'Installed' : 'Install'}
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Marketplace Page
// ---------------------------------------------------------------------------

const TYPE_TABS = [
	{ value: undefined, label: 'All' },
	{ value: 'agent' as const, label: 'Agents' },
	{ value: 'template' as const, label: 'Templates' },
];

const CATEGORIES = [
	'general', 'frontend', 'backend', 'fullstack', 'devops', 'security', 'ml', 'mobile',
];

const SORT_OPTIONS: { value: MarketplaceListOpts['sort']; label: string }[] = [
	{ value: 'downloads', label: 'Popular' },
	{ value: 'rating', label: 'Top Rated' },
	{ value: 'newest', label: 'Newest' },
];

export default function AgentMarketplace() {
	const [items, setItems] = useState<MarketplaceItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [activeType, setActiveType] = useState<'agent' | 'template' | undefined>(undefined);
	const [category, setCategory] = useState<string>('');
	const [search, setSearch] = useState('');
	const [sort, setSort] = useState<MarketplaceListOpts['sort']>('downloads');
	const [successMsg, setSuccessMsg] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await fetchMarketplaceItems({
				type: activeType,
				category: category || undefined,
				search: search || undefined,
				sort,
			});
			setItems(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load marketplace');
		} finally {
			setLoading(false);
		}
	}, [activeType, category, search, sort]);

	useEffect(() => {
		const t = setTimeout(load, search ? 300 : 0);
		return () => clearTimeout(t);
	}, [load, search]);

	const handleInstall = async (item: MarketplaceItem) => {
		await downloadMarketplaceItem(item.id);
		setSuccessMsg(`"${item.name}" installed successfully`);
		setTimeout(() => setSuccessMsg(null), 3000);
		// Refresh download count
		setItems((prev) =>
			prev.map((i) => (i.id === item.id ? { ...i, downloads: i.downloads + 1 } : i)),
		);
	};

	const handleRate = async (item: MarketplaceItem, rating: number) => {
		const result = await rateMarketplaceItem(item.id, rating);
		setItems((prev) =>
			prev.map((i) =>
				i.id === item.id ? { ...i, rating: result.rating, ratingCount: result.ratingCount } : i,
			),
		);
	};

	return (
		<div className="min-h-screen bg-[#0a0a0a] text-white p-6">
			{/* Header */}
			<div className="mb-6">
				<h1 className="text-2xl font-bold text-white">Agent Marketplace</h1>
				<p className="text-sm text-gray-400 mt-1">
					Discover and install community-shared agent configs and team templates
				</p>
			</div>

			{/* Success banner */}
			{successMsg && (
				<div className="mb-4 px-4 py-2.5 rounded border border-[#22c55e]/30 bg-[#0f2a0f] text-[#22c55e] text-sm">
					{successMsg}
				</div>
			)}

			{/* Filters */}
			<div className="flex flex-col gap-4 mb-6">
				{/* Type tabs */}
				<div className="flex gap-1 border-b border-[#262626]">
					{TYPE_TABS.map((tab) => (
						<button
							key={tab.label}
							data-testid={`type-tab-${tab.label.toLowerCase()}`}
							onClick={() => setActiveType(tab.value)}
							className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
								activeType === tab.value
									? 'border-[#22c55e] text-[#22c55e]'
									: 'border-transparent text-gray-400 hover:text-gray-200'
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>

				{/* Search + Category + Sort */}
				<div className="flex flex-wrap gap-3">
					{/* Search */}
					<input
						type="text"
						placeholder="Search marketplace..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						data-testid="search-input"
						className="flex-1 min-w-[200px] px-3 py-2 rounded border border-[#262626] bg-[#111111] text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#22c55e]/50"
					/>

					{/* Category filter */}
					<select
						value={category}
						onChange={(e) => setCategory(e.target.value)}
						data-testid="category-filter"
						className="px-3 py-2 rounded border border-[#262626] bg-[#111111] text-sm text-white focus:outline-none focus:border-[#22c55e]/50"
					>
						<option value="">All Categories</option>
						{CATEGORIES.map((cat) => (
							<option key={cat} value={cat} className="capitalize">
								{cat.charAt(0).toUpperCase() + cat.slice(1)}
							</option>
						))}
					</select>

					{/* Sort */}
					<select
						value={sort}
						onChange={(e) => setSort(e.target.value as MarketplaceListOpts['sort'])}
						data-testid="sort-dropdown"
						className="px-3 py-2 rounded border border-[#262626] bg-[#111111] text-sm text-white focus:outline-none focus:border-[#22c55e]/50"
					>
						{SORT_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</div>
			</div>

			{/* Content */}
			{loading ? (
				<div className="flex items-center justify-center py-24 text-gray-500 text-sm" data-testid="loading-state">
					Loading marketplace...
				</div>
			) : error ? (
				<div className="flex flex-col items-center justify-center py-24 gap-2">
					<p className="text-red-400 text-sm">{error}</p>
					<button
						onClick={load}
						className="text-xs px-3 py-1.5 rounded border border-[#262626] text-gray-400 hover:text-white hover:border-[#363636] transition-colors"
					>
						Retry
					</button>
				</div>
			) : items.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-24 gap-2" data-testid="empty-state">
					<p className="text-gray-500 text-sm">No marketplace items found</p>
					<p className="text-gray-600 text-xs">Try adjusting your filters or search query</p>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{items.map((item) => (
						<MarketplaceCard
							key={item.id}
							item={item}
							onInstall={handleInstall}
							onRate={handleRate}
						/>
					))}
				</div>
			)}

			{/* Item count */}
			{!loading && !error && items.length > 0 && (
				<p className="mt-4 text-xs text-gray-600 text-right">
					{items.length} item{items.length !== 1 ? 's' : ''} shown
				</p>
			)}
		</div>
	);
}
