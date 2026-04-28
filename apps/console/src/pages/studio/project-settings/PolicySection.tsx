// ---------------------------------------------------------------------------
// Policy Section
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, CheckCircle2, Shield, Plus, Lock, Edit2, Trash2, AlertCircle } from 'lucide-react';
import { fetchCustomPolicyRules, saveCustomPolicyRules, type PolicyRule } from '../../../lib/studio-api';
import { Toggle, BUILTIN_RULES_INFO, actionBadgeClass } from './helpers.js';
import PolicyRuleModal from './PolicyRuleModal.js';

interface PolicySectionProps {
	projectId: string;
}

export default function PolicySection({ projectId }: PolicySectionProps) {
	const [rules, setRules] = useState<PolicyRule[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showModal, setShowModal] = useState(false);
	const [editTarget, setEditTarget] = useState<PolicyRule | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchCustomPolicyRules(projectId);
			setRules(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Policy yuklenemedi');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => { load(); }, [load]);

	const persist = async (next: PolicyRule[]) => {
		setSaving(true);
		setError(null);
		try {
			await saveCustomPolicyRules(projectId, next);
			setRules(next);
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Kaydedilemedi');
		} finally {
			setSaving(false);
		}
	};

	const handleSaveRule = (rule: PolicyRule) => {
		const idx = rules.findIndex((r) => r.id === rule.id);
		const next = idx >= 0 ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
		setShowModal(false);
		setEditTarget(null);
		void persist(next);
	};

	const handleToggle = (rule: PolicyRule) => {
		void persist(rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
	};

	const handleDelete = (rule: PolicyRule) => {
		if (!confirm(`"${rule.name}" kuralini sil?`)) return;
		void persist(rules.filter((r) => r.id !== rule.id));
	};

	const handleAdd = () => {
		setEditTarget(null);
		setShowModal(true);
	};

	const handleEdit = (rule: PolicyRule) => {
		setEditTarget(rule);
		setShowModal(true);
	};

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Shield size={14} className="text-[#22c55e]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Policy Rules</h3>
				<span className="ml-auto flex items-center gap-3">
					{saving && <Loader2 size={12} className="animate-spin text-[#525252]" />}
					{saved && (
						<span className="flex items-center gap-1 text-[10px] text-[#22c55e]">
							<CheckCircle2 size={10} />
							Saved
						</span>
					)}
					<button
						onClick={handleAdd}
						className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
					>
						<Plus size={10} />
						Kural Ekle
					</button>
				</span>
			</div>

			<div className="px-4 py-2">
				<p className="text-[10px] text-[#525252]">
					Gorev baslatilmadan once kosullari degerlendirir; bloklama, uyari veya onay isteyebilir.
					Yerlesik kurallar daima aktiftir; kendi ozel kurallarinizi ekleyebilirsiniz.
				</p>
			</div>

			{error && (
				<div className="mx-4 mb-2 flex items-center gap-2 px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
					<AlertCircle size={10} />
					{error}
				</div>
			)}

			<div className="px-4 pb-3">
				<div className="text-[9px] uppercase tracking-wider text-[#525252] mb-1.5">Yerlesik Kurallar</div>
				<div className="space-y-1.5">
					{BUILTIN_RULES_INFO.map((r) => (
						<div key={r.id} className="flex items-start gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded">
							<Lock size={11} className="text-[#525252] mt-0.5 shrink-0" />
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-[11px] text-[#fafafa] font-medium">{r.name}</span>
									<span className="text-[9px] text-[#525252]">({r.setting})</span>
								</div>
								<div className="text-[10px] text-[#a3a3a3] mt-0.5">{r.description}</div>
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="px-4 pb-4">
				<div className="text-[9px] uppercase tracking-wider text-[#525252] mb-1.5">Ozel Kurallar</div>
				{loading ? (
					<div className="flex justify-center py-4">
						<Loader2 size={14} className="animate-spin text-[#525252]" />
					</div>
				) : rules.length === 0 ? (
					<div className="text-center py-4 text-[10px] text-[#525252] bg-[#0a0a0a] border border-[#1a1a1a] rounded">
						Henuz ozel kural yok. &quot;Kural Ekle&quot; butonuna tiklayin.
					</div>
				) : (
					<div className="space-y-1.5">
						{rules.map((r) => (
							<div
								key={r.id}
								className={`flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded ${!r.enabled ? 'opacity-50' : ''}`}
							>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 flex-wrap">
										<span className="text-[11px] text-[#fafafa] font-medium">{r.name}</span>
										<span className={`text-[9px] px-1.5 py-0.5 border rounded ${actionBadgeClass(r.action)}`}>
											{r.action}
										</span>
									</div>
									<div className="text-[10px] text-[#a3a3a3] mt-0.5 font-mono">{r.condition}</div>
								</div>
								<div className="flex items-center gap-1 shrink-0">
									<Toggle value={r.enabled} onChange={() => handleToggle(r)} />
									<button
										onClick={() => handleEdit(r)}
										className="p-1 text-[#525252] hover:text-[#a3a3a3] transition-colors"
										title="Duzenle"
									>
										<Edit2 size={11} />
									</button>
									<button
										onClick={() => handleDelete(r)}
										className="p-1 text-[#525252] hover:text-[#f87171] transition-colors"
										title="Sil"
									>
										<Trash2 size={11} />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{showModal && (
				<PolicyRuleModal
					projectId={projectId}
					initial={editTarget}
					onClose={() => { setShowModal(false); setEditTarget(null); }}
					onSave={handleSaveRule}
				/>
			)}
		</div>
	);
}
