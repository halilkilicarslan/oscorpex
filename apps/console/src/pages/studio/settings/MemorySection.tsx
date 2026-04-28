import { useState, useEffect, useCallback } from 'react';
import {
	Loader2,
	Plus,
	AlertCircle,
	Brain,
	RefreshCw,
	ChevronDown,
	ChevronRight,
	User,
	Bot,
	Edit2,
	Trash2,
	Save,
	X,
} from 'lucide-react';
import {
	fetchMemoryContext,
	fetchMemoryFacts,
	refreshMemorySnapshot,
	upsertMemoryFact,
	deleteMemoryFact,
	type MemoryFact,
} from '../../../lib/studio-api';

interface FactDraft {
	scope: string;
	key: string;
	value: string;
	confidence: number;
}

const EMPTY_DRAFT: FactDraft = { scope: '', key: '', value: '', confidence: 1.0 };

function FactRow({
	fact,
	onSave,
	onDelete,
}: {
	fact: MemoryFact;
	onSave: (next: FactDraft) => Promise<void>;
	onDelete: () => Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<FactDraft>({
		scope: fact.scope,
		key: fact.key,
		value: fact.value,
		confidence: fact.confidence,
	});
	const [busy, setBusy] = useState(false);

	const isUser = fact.source === 'user';

	const handleSave = async () => {
		setBusy(true);
		try {
			await onSave(draft);
			setEditing(false);
		} finally {
			setBusy(false);
		}
	};

	const handleDelete = async () => {
		if (!confirm(`"${fact.scope}.${fact.key}" fact'ini sil?`)) return;
		setBusy(true);
		try {
			await onDelete();
		} finally {
			setBusy(false);
		}
	};

	if (editing) {
		return (
			<div className="px-3 py-2 bg-[#0a0a0a] border border-[#22c55e]/30 rounded space-y-1.5">
				<div className="flex items-center gap-1.5">
					<input
						type="text"
						value={draft.value}
						onChange={(e) => setDraft({ ...draft, value: e.target.value })}
						placeholder="Yeni deger"
						className="flex-1 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
					/>
					<input
						type="number"
						min="0"
						max="1"
						step="0.1"
						value={draft.confidence}
						onChange={(e) => setDraft({ ...draft, confidence: parseFloat(e.target.value) || 0 })}
						className="w-14 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
						title="Confidence (0-1)"
					/>
					<button
						type="button"
						onClick={handleSave}
						disabled={busy}
						className="p-1 text-[#22c55e] hover:bg-[#22c55e]/10 rounded transition-colors disabled:opacity-40"
						title="Save"
					>
						{busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
					</button>
					<button
						type="button"
						onClick={() => setEditing(false)}
						disabled={busy}
						className="p-1 text-[#525252] hover:text-[#a3a3a3] rounded transition-colors disabled:opacity-40"
						title="Iptal"
					>
						<X size={11} />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded">
			<span
				className={`shrink-0 ${isUser ? 'text-[#22c55e]' : 'text-[#525252]'}`}
				title={isUser ? 'Manuel girilmis' : `Kaynak: ${fact.source}`}
			>
				{isUser ? <User size={10} /> : <Bot size={10} />}
			</span>
			<div className="flex-1 min-w-0 flex items-center gap-2">
				<span className="text-[10px] font-mono text-[#a3a3a3]">{fact.key}</span>
				<span className="text-[10px] text-[#525252]">=</span>
				<span className="text-[11px] text-[#fafafa] truncate" title={fact.value}>{fact.value}</span>
				{fact.confidence < 1.0 && (
					<span className="text-[9px] text-[#525252] shrink-0" title="Confidence">
						({fact.confidence.toFixed(1)})
					</span>
				)}
			</div>
			<div className="flex items-center gap-0.5 shrink-0">
				<button
					type="button"
					onClick={() => setEditing(true)}
					className="p-1 text-[#525252] hover:text-[#a3a3a3] transition-colors"
					title="Duzenle"
				>
					<Edit2 size={10} />
				</button>
				<button
					type="button"
					onClick={handleDelete}
					disabled={busy}
					className="p-1 text-[#525252] hover:text-[#f87171] transition-colors disabled:opacity-40"
					title="Sil"
				>
					<Trash2 size={10} />
				</button>
			</div>
		</div>
	);
}

export function MemorySection({ projectId }: { projectId: string }) {
	const [facts, setFacts] = useState<MemoryFact[]>([]);
	const [contextText, setContextText] = useState<string>('');
	const [showContext, setShowContext] = useState(false);
	const [openScopes, setOpenScopes] = useState<Record<string, boolean>>({});
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState<FactDraft>(EMPTY_DRAFT);
	const [adding, setAdding] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [factsData, ctxText] = await Promise.all([
				fetchMemoryFacts(projectId),
				fetchMemoryContext(projectId).catch(() => ''),
			]);
			setFacts(factsData);
			setContextText(ctxText);
			const scopes = new Set(factsData.map((f) => f.scope));
			const map: Record<string, boolean> = {};
			for (const s of scopes) map[s] = true;
			setOpenScopes(map);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Memory yuklenemedi');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => { load(); }, [load]);

	const handleRefresh = async () => {
		setRefreshing(true);
		setError(null);
		try {
			await refreshMemorySnapshot(projectId);
			const ctx = await fetchMemoryContext(projectId).catch(() => '');
			setContextText(ctx);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Refresh failed');
		} finally {
			setRefreshing(false);
		}
	};

	const handleAdd = async () => {
		if (!draft.scope.trim() || !draft.key.trim()) {
			setError('scope ve key zorunlu');
			return;
		}
		setAdding(true);
		setError(null);
		try {
			await upsertMemoryFact(projectId, {
				scope: draft.scope.trim(),
				key: draft.key.trim(),
				value: draft.value,
				confidence: draft.confidence,
				source: 'user',
			});
			setDraft(EMPTY_DRAFT);
			await load();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Eklenemedi');
		} finally {
			setAdding(false);
		}
	};

	const handleSaveFact = async (original: MemoryFact, next: FactDraft) => {
		await upsertMemoryFact(projectId, {
			scope: original.scope,
			key: original.key,
			value: next.value,
			confidence: next.confidence,
			source: original.source === 'user' ? 'user' : original.source,
		});
		await load();
	};

	const handleDeleteFact = async (fact: MemoryFact) => {
		await deleteMemoryFact(projectId, fact.scope, fact.key);
		await load();
	};

	const factsByScope = facts.reduce<Record<string, MemoryFact[]>>((acc, f) => {
		(acc[f.scope] ??= []).push(f);
		return acc;
	}, {});
	const scopeNames = Object.keys(factsByScope).sort();

	const userFactCount = facts.filter((f) => f.source === 'user').length;
	const autoFactCount = facts.length - userFactCount;

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Brain size={14} className="text-[#22c55e]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Project Memory</h3>
				<span className="text-[10px] text-[#525252]">
					{facts.length} fact ({userFactCount} user / {autoFactCount} auto)
				</span>
				<span className="ml-auto flex items-center gap-3">
					<button
						type="button"
						onClick={handleRefresh}
						disabled={refreshing}
						className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors disabled:opacity-40"
						title="Working memory snapshot'ini yenile"
					>
						{refreshing ? (
							<Loader2 size={10} className="animate-spin" />
						) : (
							<RefreshCw size={10} />
						)}
						Snapshot Yenile
					</button>
				</span>
			</div>

			<div className="px-4 py-2">
				<p className="text-[10px] text-[#525252]">
					AI'nin proje hakkinda hatirladigi bilgiler. Manuel ekledikleriniz (user)
					her prompt'a otomatik enjekte edilir; ornegin &quot;testing.framework = vitest only&quot;.
				</p>
			</div>

			{error && (
				<div className="mx-4 mb-2 flex items-center gap-2 px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
					<AlertCircle size={10} />
					{error}
				</div>
			)}

			<div className="px-4 pb-3">
				<div className="flex items-center gap-1.5">
					<input
						type="text"
						value={draft.scope}
						onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
						placeholder="scope (e.g. testing)"
						className="w-28 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e] font-mono"
					/>
					<span className="text-[10px] text-[#525252]">.</span>
					<input
						type="text"
						value={draft.key}
						onChange={(e) => setDraft({ ...draft, key: e.target.value })}
						placeholder="key (e.g. framework)"
						className="w-32 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e] font-mono"
					/>
					<span className="text-[10px] text-[#525252]">=</span>
					<input
						type="text"
						value={draft.value}
						onChange={(e) => setDraft({ ...draft, value: e.target.value })}
						placeholder="value"
						className="flex-1 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e]"
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={adding || !draft.scope.trim() || !draft.key.trim()}
						className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#22c55e] text-black font-medium rounded hover:bg-[#16a34a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{adding ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
						Ekle
					</button>
				</div>
			</div>

			<div className="px-4 pb-3">
				{loading ? (
					<div className="flex justify-center py-4">
						<Loader2 size={14} className="animate-spin text-[#525252]" />
					</div>
				) : facts.length === 0 ? (
					<div className="text-center py-4 text-[10px] text-[#525252] bg-[#0a0a0a] border border-[#1a1a1a] rounded">
						Henuz fact yok. Yukaridaki forma scope/key/value girip ekleyin.
					</div>
				) : (
					<div className="space-y-2">
						{scopeNames.map((scope) => {
							const isOpen = openScopes[scope] ?? true;
							const items = factsByScope[scope];
							return (
								<div key={scope}>
									<button
										type="button"
										onClick={() => setOpenScopes({ ...openScopes, [scope]: !isOpen })}
										className="flex items-center gap-1 w-full text-left mb-1 hover:text-[#fafafa]"
									>
										{isOpen ? (
											<ChevronDown size={10} className="text-[#525252]" />
										) : (
											<ChevronRight size={10} className="text-[#525252]" />
										)}
										<span className="text-[9px] uppercase tracking-wider text-[#525252]">{scope}</span>
										<span className="text-[9px] text-[#525252]">({items.length})</span>
									</button>
									{isOpen && (
										<div className="space-y-1 ml-3">
											{items.map((f) => (
												<FactRow
													key={`${f.scope}.${f.key}`}
													fact={f}
													onSave={(next) => handleSaveFact(f, next)}
													onDelete={() => handleDeleteFact(f)}
												/>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			<div className="border-t border-[#1a1a1a]">
				<button
					type="button"
					onClick={() => setShowContext(!showContext)}
					className="w-full flex items-center gap-1 px-4 py-2 text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#0a0a0a] transition-colors"
				>
					{showContext ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
					AI'nin gordugu context (working summary)
				</button>
				{showContext && (
					<div className="px-4 pb-3">
						<pre className="px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded text-[10px] text-[#a3a3a3] font-mono whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
							{contextText.trim() || '(snapshot henuz olusturulmadi — "Snapshot Yenile" butonuna basin)'}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}
