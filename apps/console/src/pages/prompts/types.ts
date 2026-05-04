// ---------------------------------------------------------------------------
// Prompts — shared types and constants
// ---------------------------------------------------------------------------

export type Category = 'system' | 'user' | 'agent' | 'tool' | 'general';
export type SortOrder = 'recent' | 'most_used' | 'alpha';

export interface PromptTemplate {
	id: string;
	name: string;
	description: string;
	category: Category;
	content: string;
	variables: string[];
	tags: string[];
	version: number;
	parent_id: string | null;
	is_active: boolean;
	usage_count: number;
	created_at: string;
	updated_at: string;
}

export interface TemplateDetail {
	template: PromptTemplate;
	history: PromptTemplate[];
}

export interface PromptStats {
	totalTemplates: number;
	byCategory: Record<string, number>;
	totalVersions: number;
	mostUsed: Array<{ id: string; name: string; usage_count: number }>;
	recentlyUpdated: Array<{ id: string; name: string; updated_at: string }>;
}

export interface TemplateListResponse {
	templates: PromptTemplate[];
	total: number;
	limit: number;
	offset: number;
}

export interface EditorFormState {
	name: string;
	description: string;
	category: Category;
	content: string;
	variables: string[];
	tags: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_BASE = '/api/observability/prompts';

export const CATEGORIES: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'system', label: 'System' },
	{ value: 'user', label: 'User' },
	{ value: 'agent', label: 'Agent' },
	{ value: 'tool', label: 'Tool' },
	{ value: 'general', label: 'General' },
];

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
	system:  { bg: 'bg-[#3b82f6]/10', text: 'text-[#3b82f6]', border: 'border-[#3b82f6]/30' },
	user:    { bg: 'bg-[#22c55e]/10', text: 'text-[#22c55e]', border: 'border-[#22c55e]/30' },
	agent:   { bg: 'bg-[#a855f7]/10', text: 'text-[#a855f7]', border: 'border-[#a855f7]/30' },
	tool:    { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]', border: 'border-[#f59e0b]/30' },
	general: { bg: 'bg-[#525252]/10', text: 'text-[#a3a3a3]', border: 'border-[#525252]/30' },
};

export function categoryClass(cat: string): string {
	const c = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
	return `${c.bg} ${c.text} ${c.border}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function relativeTime(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	if (diff < 60_000) return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

export function extractVariables(content: string): string[] {
	const matches = content.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g);
	const vars = new Set<string>();
	for (const match of matches) {
		vars.add(match[1]);
	}
	return Array.from(vars);
}

export function previewLines(content: string, maxLines = 3): string {
	const lines = content.split('\n').slice(0, maxLines);
	const joined = lines.join('\n');
	const full = content.split('\n').length;
	return full > maxLines ? joined + '\n...' : joined;
}
