import { useState, useEffect } from 'react';
import { History, X, Clock, RotateCcw, AlertCircle } from 'lucide-react';
import { httpGet } from '../../lib/studio-api/base.js';
import { type TemplateDetail, API_BASE, relativeTime } from './types.js';

function diffText(a: string, b: string): Array<{ type: 'same' | 'add' | 'remove'; line: string }> {
	const aLines = a.split('\n');
	const bLines = b.split('\n');
	const result: Array<{ type: 'same' | 'add' | 'remove'; line: string }> = [];
	const aSet = new Set(aLines);
	const bSet = new Set(bLines);
	for (const line of aLines) {
		result.push({ type: bSet.has(line) ? 'same' : 'remove', line });
	}
	for (const line of bLines) {
		if (!aSet.has(line)) result.push({ type: 'add', line });
	}
	return result;
}

interface VersionHistoryPanelProps {
	templateId: string;
	onClose: () => void;
}

export function VersionHistoryPanel({ templateId, onClose }: VersionHistoryPanelProps) {
	const [data, setData] = useState<TemplateDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedPair, setSelectedPair] = useState<number | null>(null);

	useEffect(() => {
		setLoading(true);
		httpGet<TemplateDetail>(`${API_BASE}/${templateId}`)
			.then(setData)
			.catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load'))
			.finally(() => setLoading(false));
	}, [templateId]);

	const versions = data
		? [data.template, ...data.history].sort((a, b) => b.version - a.version)
		: [];

	const diffPair = selectedPair !== null && versions.length > selectedPair + 1
		? diffText(versions[selectedPair + 1].content, versions[selectedPair].content)
		: null;

	return (
		<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
			<div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between px-6 py-4 border-b border-[#1f1f1f] shrink-0">
					<div className="flex items-center gap-2">
						<History size={16} className="text-[#a3a3a3]" />
						<h2 className="text-[15px] font-semibold text-[#fafafa]">Version History</h2>
					</div>
					<button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
						<X size={16} className="text-[#525252]" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-6">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<div className="w-6 h-6 rounded-full border-2 border-[#262626] border-t-[#22c55e] animate-spin" />
						</div>
					) : error ? (
						<div className="flex items-center gap-2 text-[#ef4444] text-[13px]">
							<AlertCircle size={14} />{error}
						</div>
					) : versions.length === 0 ? (
						<p className="text-[13px] text-[#525252] text-center py-8">No version history.</p>
					) : (
						<div className="space-y-3">
							{versions.map((v, idx) => (
								<div key={v.id} className="border border-[#1f1f1f] rounded-xl overflow-hidden">
									<div className="flex items-center justify-between px-4 py-3 bg-[#0d0d0d]">
										<div className="flex items-center gap-2">
											<span className="text-[11px] font-medium text-[#fafafa] bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] px-2 py-0.5 rounded">
												v{v.version}
											</span>
											{idx === 0 && (
												<span className="text-[10px] text-[#525252] font-medium bg-[#1f1f1f] border border-[#333] px-2 py-0.5 rounded">
													current
												</span>
											)}
										</div>
										<div className="flex items-center gap-3">
											<span className="text-[11px] text-[#525252] flex items-center gap-1">
												<Clock size={10} />{relativeTime(v.updated_at)}
											</span>
											{idx < versions.length - 1 && (
												<button
													onClick={() => setSelectedPair(selectedPair === idx ? null : idx)}
													className="text-[10px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors flex items-center gap-1"
												>
													<RotateCcw size={10} />
													{selectedPair === idx ? 'Hide diff' : 'Diff'}
												</button>
											)}
										</div>
									</div>

									{selectedPair === idx && diffPair && (
										<div className="border-t border-[#1f1f1f] bg-[#080808] p-4 max-h-64 overflow-y-auto">
											<pre className="text-[11px] font-mono leading-relaxed">
												{diffPair.map((d, i) => (
													<div
														key={i}
														className={
															d.type === 'add' ? 'text-[#22c55e] bg-[#22c55e]/5'
																: d.type === 'remove' ? 'text-[#ef4444] bg-[#ef4444]/5'
																: 'text-[#525252]'
														}
													>
														{d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  '}
														{d.line}
													</div>
												))}
											</pre>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
