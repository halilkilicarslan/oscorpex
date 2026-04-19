import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
	Search,
	Star,
	Users,
	ArrowRight,
	Plus,
	Loader2,
	Layout,
	Server,
	Layers,
	Smartphone,
	Globe,
	Boxes,
} from 'lucide-react';
import type { ProjectTemplate } from '../../lib/studio-api/templates.js';
import { fetchTemplates, useTemplate as apiUseTemplate } from '../../lib/studio-api/templates.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
	{ key: 'all', label: 'All', icon: <Boxes size={14} /> },
	{ key: 'frontend', label: 'Frontend', icon: <Layout size={14} /> },
	{ key: 'backend', label: 'Backend', icon: <Server size={14} /> },
	{ key: 'fullstack', label: 'Fullstack', icon: <Layers size={14} /> },
	{ key: 'mobile', label: 'Mobile', icon: <Smartphone size={14} /> },
	{ key: 'api', label: 'API', icon: <Globe size={14} /> },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

// ---------------------------------------------------------------------------
// StarRating
// ---------------------------------------------------------------------------

function StarRating({ rating }: { rating: number }) {
	const full = Math.floor(rating);
	const half = rating - full >= 0.5;
	return (
		<span className="flex items-center gap-0.5">
			{Array.from({ length: 5 }).map((_, i) => (
				<Star
					key={i}
					size={12}
					className={
						i < full
							? 'text-[#f59e0b] fill-[#f59e0b]'
							: i === full && half
								? 'text-[#f59e0b] fill-[#f59e0b] opacity-60'
								: 'text-[#404040]'
					}
				/>
			))}
			<span className="text-[#737373] text-xs ml-1">{rating.toFixed(1)}</span>
		</span>
	);
}

// ---------------------------------------------------------------------------
// TechBadge
// ---------------------------------------------------------------------------

function TechBadge({ label }: { label: string }) {
	return (
		<span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1a2e1a] text-[#86efac] border border-[#166534]">
			{label}
		</span>
	);
}

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

interface TemplateCardProps {
	template: ProjectTemplate;
	onUse: (template: ProjectTemplate) => void;
	loading: boolean;
}

function TemplateCard({ template, onUse, loading }: TemplateCardProps) {
	const visibleStack = template.techStack.slice(0, 4);
	const extra = template.techStack.length - visibleStack.length;

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-lg p-4 flex flex-col gap-3 hover:border-[#404040] transition-colors">
			{/* Header */}
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<h3 className="text-sm font-semibold text-[#f5f5f5] truncate">{template.name}</h3>
					<span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1c1c1c] text-[#737373] border border-[#262626] capitalize">
						{template.category}
					</span>
				</div>
			</div>

			{/* Description */}
			<p className="text-xs text-[#737373] leading-relaxed line-clamp-2 flex-1">
				{template.description || 'No description provided.'}
			</p>

			{/* Tech Stack */}
			{visibleStack.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{visibleStack.map((tech) => (
						<TechBadge key={tech} label={tech} />
					))}
					{extra > 0 && (
						<span className="px-1.5 py-0.5 rounded text-[10px] text-[#525252]">+{extra} more</span>
					)}
				</div>
			)}

			{/* Footer */}
			<div className="flex items-center justify-between pt-1 border-t border-[#1c1c1c]">
				<div className="flex items-center gap-3">
					<StarRating rating={template.rating} />
					<span className="flex items-center gap-1 text-xs text-[#525252]">
						<Users size={11} />
						{template.usageCount.toLocaleString()}
					</span>
				</div>
				<button
					type="button"
					onClick={() => onUse(template)}
					disabled={loading}
					aria-label={`Use template ${template.name}`}
					className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#22c55e] hover:bg-[#16a34a] text-[#0a0a0a] text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{loading ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
					Use
				</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// TemplateGallery page
// ---------------------------------------------------------------------------

export default function TemplateGallery() {
	const navigate = useNavigate();
	const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [category, setCategory] = useState<CategoryKey>('all');
	const [search, setSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [usingId, setUsingId] = useState<string | null>(null);

	// Debounce search
	useEffect(() => {
		const t = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(t);
	}, [search]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await fetchTemplates({
				category: category === 'all' ? undefined : category,
				search: debouncedSearch || undefined,
				limit: 100,
			});
			setTemplates(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load templates');
		} finally {
			setLoading(false);
		}
	}, [category, debouncedSearch]);

	useEffect(() => {
		load();
	}, [load]);

	const handleUse = useCallback(
		async (template: ProjectTemplate) => {
			setUsingId(template.id);
			try {
				await apiUseTemplate(template.id);
				// Navigate to project creation with template pre-filled
				navigate('/studio/new', {
					state: {
						template: {
							name: template.name,
							description: template.description,
							techStack: template.techStack,
							agentConfig: template.agentConfig,
							phases: template.phases,
							templateId: template.id,
						},
					},
				});
			} catch (err) {
				console.error('[TemplateGallery] useTemplate failed:', err);
			} finally {
				setUsingId(null);
			}
		},
		[navigate],
	);

	return (
		<div className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5]">
			{/* Page header */}
			<div className="border-b border-[#262626] px-6 py-5">
				<div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
					<div>
						<h1 className="text-lg font-bold text-[#f5f5f5]">Template Gallery</h1>
						<p className="text-sm text-[#737373] mt-0.5">
							Start your project from a pre-built template
						</p>
					</div>
					<button
						type="button"
						onClick={() => navigate('/studio/templates/new')}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1c1c1c] border border-[#262626] hover:border-[#404040] text-sm text-[#f5f5f5] transition-colors"
					>
						<Plus size={14} />
						New Template
					</button>
				</div>
			</div>

			<div className="max-w-6xl mx-auto px-6 py-6">
				{/* Search + Category filters */}
				<div className="flex flex-col sm:flex-row gap-3 mb-6">
					{/* Search */}
					<div className="relative flex-1">
						<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
						<input
							type="text"
							placeholder="Search templates..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							aria-label="Search templates"
							className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#111111] border border-[#262626] text-sm text-[#f5f5f5] placeholder:text-[#525252] focus:outline-none focus:border-[#404040] transition-colors"
						/>
					</div>

					{/* Category tabs */}
					<div className="flex items-center gap-1 bg-[#111111] border border-[#262626] rounded-lg p-1">
						{CATEGORIES.map((cat) => (
							<button
								key={cat.key}
								type="button"
								onClick={() => setCategory(cat.key)}
								aria-label={`Filter by ${cat.label}`}
								className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
									category === cat.key
										? 'bg-[#22c55e] text-[#0a0a0a]'
										: 'text-[#737373] hover:text-[#f5f5f5]'
								}`}
							>
								{cat.icon}
								{cat.label}
							</button>
						))}
					</div>
				</div>

				{/* Content */}
				{loading ? (
					<div className="flex items-center justify-center py-24">
						<div className="flex flex-col items-center gap-3 text-[#525252]">
							<Loader2 size={28} className="animate-spin" />
							<span className="text-sm">Loading templates...</span>
						</div>
					</div>
				) : error ? (
					<div className="flex items-center justify-center py-24">
						<div className="flex flex-col items-center gap-3 text-center">
							<p className="text-sm text-[#ef4444]">{error}</p>
							<button
								type="button"
								onClick={load}
								className="px-3 py-1.5 rounded bg-[#1c1c1c] border border-[#262626] text-sm text-[#f5f5f5] hover:border-[#404040] transition-colors"
							>
								Retry
							</button>
						</div>
					</div>
				) : templates.length === 0 ? (
					<div className="flex items-center justify-center py-24">
						<div className="flex flex-col items-center gap-3 text-center">
							<Boxes size={32} className="text-[#404040]" />
							<p className="text-sm text-[#737373]">
								{debouncedSearch || category !== 'all'
									? 'No templates match your filters.'
									: 'No templates yet. Create the first one!'}
							</p>
							{(debouncedSearch || category !== 'all') && (
								<button
									type="button"
									onClick={() => {
										setSearch('');
										setCategory('all');
									}}
									className="text-xs text-[#22c55e] hover:underline"
								>
									Clear filters
								</button>
							)}
						</div>
					</div>
				) : (
					<>
						<p className="text-xs text-[#525252] mb-4">
							{templates.length} template{templates.length !== 1 ? 's' : ''} found
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
							{templates.map((tpl) => (
								<TemplateCard
									key={tpl.id}
									template={tpl}
									onUse={handleUse}
									loading={usingId === tpl.id}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
