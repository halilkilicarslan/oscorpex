import { FileText, Globe, Code2, Table2 } from 'lucide-react';

export const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
	text: { label: 'Text', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', Icon: FileText },
	pdf: { label: 'PDF', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', Icon: FileText },
	web: { label: 'Web', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', Icon: Globe },
	code: { label: 'Code', color: '#22c55e', bg: 'rgba(34,197,94,0.15)', Icon: Code2 },
	csv: { label: 'CSV', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', Icon: Table2 },
};

export const EMBEDDING_MODELS = [
	'text-embedding-3-small',
	'text-embedding-3-large',
	'text-embedding-ada-002',
];

export const STATUS_COLORS: Record<string, string> = {
	active: '#22c55e',
	indexing: '#f59e0b',
	error: '#ef4444',
	pending: '#525252',
	indexed: '#22c55e',
};

export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelTime(iso: string | null): string {
	if (!iso) return 'Never';
	const diff = Date.now() - new Date(iso).getTime();
	const s = Math.floor(diff / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

export function truncate(str: string, n: number): string {
	return str.length > n ? str.slice(0, n) + '...' : str;
}
