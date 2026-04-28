// ---------------------------------------------------------------------------
// Approval Keywords Section
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, CheckCircle2, Lock, Plus, X } from 'lucide-react';
import { fetchApprovalKeywords, saveApprovalKeywords } from '../../../lib/studio-api';

interface ApprovalKeywordsSectionProps {
	projectId: string;
}

export default function ApprovalKeywordsSection({ projectId }: ApprovalKeywordsSectionProps) {
	const [keywords, setKeywords] = useState<string[]>([]);
	const [input, setInput] = useState('');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchApprovalKeywords(projectId);
			setKeywords(data);
		} catch { /* defaults already handled by API */ }
		finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => { load(); }, [load]);

	const persist = async (next: string[]) => {
		setSaving(true);
		try {
			await saveApprovalKeywords(projectId, next);
			setKeywords(next);
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		} catch { /* silent */ }
		finally {
			setSaving(false);
		}
	};

	const addKeyword = () => {
		const trimmed = input.trim().toLowerCase();
		if (!trimmed || keywords.includes(trimmed)) return;
		void persist([...keywords, trimmed]);
		setInput('');
	};

	const removeKeyword = (kw: string) => {
		void persist(keywords.filter((k) => k !== kw));
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			addKeyword();
		}
	};

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Lock size={14} className="text-[#f59e0b]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Approval Keywords</h3>
				<span className="ml-auto flex items-center gap-2">
					{saving && <Loader2 size={12} className="animate-spin text-[#525252]" />}
					{saved && <CheckCircle2 size={12} className="text-[#22c55e]" />}
				</span>
			</div>
			<div className="px-4 py-3 space-y-3">
				<p className="text-[10px] text-[#525252]">
					Task basligi veya aciklamasinda bu keyword'lerden biri gecerse, task otomatik onay bekler. XL complexity her zaman onay gerektirir.
				</p>
				{loading ? (
					<div className="flex justify-center py-4">
						<Loader2 size={14} className="animate-spin text-[#525252]" />
					</div>
				) : (
					<>
						<div className="flex flex-wrap gap-1.5">
							{keywords.map((kw) => (
								<span
									key={kw}
									className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-[#1a1a1a] border border-[#262626] text-[#e4e4e7]"
								>
									{kw}
									<button
										type="button"
										onClick={() => removeKeyword(kw)}
										className="text-[#525252] hover:text-[#ef4444] transition-colors"
									>
										<X size={10} />
									</button>
								</span>
							))}
							{keywords.length === 0 && (
								<span className="text-[10px] text-[#525252]">Keyword eklenmemis — default liste kullanilacak.</span>
							)}
						</div>
						<div className="flex gap-2">
							<input
								type="text"
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="Yeni keyword ekle..."
								className="flex-1 px-2 py-1 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded-md text-[#e4e4e7] placeholder:text-[#525252] focus:outline-none focus:border-[#22c55e]"
							/>
							<button
								type="button"
								onClick={addKeyword}
								disabled={!input.trim()}
								className="px-2 py-1 text-[10px] rounded-md bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 disabled:opacity-30 transition-colors"
							>
								<Plus size={12} />
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
