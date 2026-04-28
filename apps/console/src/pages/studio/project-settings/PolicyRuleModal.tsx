// ---------------------------------------------------------------------------
// Policy Rule Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { PolicyRule, PolicyAction } from '../../../lib/studio-api';
import { Toggle, parseCondition, buildCondition, POLICY_ACTIONS, CONDITION_PATTERNS, type ConditionPattern } from './helpers.js';

interface PolicyRuleModalProps {
	projectId: string;
	initial: PolicyRule | null;
	onClose: () => void;
	onSave: (rule: PolicyRule) => void;
}

export default function PolicyRuleModal({ projectId, initial, onClose, onSave }: PolicyRuleModalProps) {
	const parsed = initial ? parseCondition(initial.condition) : { pattern: 'complexity' as ConditionPattern, value: '' };
	const [name, setName] = useState(initial?.name ?? '');
	const [pattern, setPattern] = useState<ConditionPattern>(parsed.pattern);
	const [value, setValue] = useState(parsed.value);
	const [action, setAction] = useState<PolicyAction>((initial?.action as PolicyAction) ?? 'warn');
	const [enabled, setEnabled] = useState(initial?.enabled ?? true);
	const [error, setError] = useState<string | null>(null);

	const handleSave = () => {
		if (!name.trim()) { setError('Kural adi zorunludur'); return; }
		if (!value.trim()) { setError('Kosul degeri zorunludur'); return; }
		const rule: PolicyRule = {
			id: initial?.id ?? `custom-${Date.now()}`,
			projectId,
			name: name.trim(),
			condition: buildCondition(pattern, value),
			action,
			enabled,
		};
		onSave(rule);
	};

	const placeholder = CONDITION_PATTERNS.find((p) => p.value === pattern)?.placeholder ?? '';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div className="w-full max-w-md bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
				<div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
					<h3 className="text-[12px] font-semibold text-[#fafafa]">
						{initial ? 'Kurali Duzenle' : 'Yeni Kural'}
					</h3>
					<button onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3]">
						<X size={14} />
					</button>
				</div>

				<div className="p-4 space-y-3">
					{error && (
						<div className="flex items-center gap-2 px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
							<AlertCircle size={10} />
							{error}
						</div>
					)}

					<div>
						<label className="block text-[10px] text-[#a3a3a3] mb-1">Kural Adi</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Ornegin: Security-sensitive path gate"
							className="w-full px-2.5 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e]"
						/>
					</div>

					<div>
						<label className="block text-[10px] text-[#a3a3a3] mb-1">Kosul</label>
						<div className="flex gap-2">
							<select
								value={pattern}
								onChange={(e) => setPattern(e.target.value as ConditionPattern)}
								className="px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e]"
							>
								{CONDITION_PATTERNS.map((p) => (
									<option key={p.value} value={p.value}>{p.label}</option>
								))}
							</select>
							<input
								type="text"
								value={value}
								onChange={(e) => setValue(e.target.value)}
								placeholder={placeholder}
								className="flex-1 px-2.5 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] placeholder-[#404040] focus:outline-none focus:border-[#22c55e]"
							/>
						</div>
					</div>

					<div>
						<label className="block text-[10px] text-[#a3a3a3] mb-1">Aksiyon</label>
						<div className="flex gap-1.5">
							{POLICY_ACTIONS.map((a) => (
								<button
									key={a.value}
									onClick={() => setAction(a.value)}
									className={`flex-1 px-2 py-1.5 text-[10px] border rounded transition-colors ${
										action === a.value
											? a.color
											: 'text-[#525252] border-[#262626] hover:border-[#404040]'
									}`}
								>
									{a.label}
								</button>
							))}
						</div>
					</div>

					<div className="flex items-center justify-between">
						<label className="text-[10px] text-[#a3a3a3]">Aktif</label>
						<Toggle value={enabled} onChange={setEnabled} />
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1a1a1a]">
					<button onClick={onClose} className="px-3 py-1.5 text-[10px] text-[#a3a3a3] hover:text-[#fafafa] transition-colors">
						Iptal
					</button>
					<button
						onClick={handleSave}
						className="px-3 py-1.5 text-[10px] bg-[#22c55e] text-black font-medium rounded hover:bg-[#16a34a] transition-colors"
					>
						Save
					</button>
				</div>
			</div>
		</div>
	);
}
