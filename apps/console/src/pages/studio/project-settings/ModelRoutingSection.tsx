// ---------------------------------------------------------------------------
// Model Routing Section
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Save, RotateCcw, Cpu } from 'lucide-react';
import { fetchProviders, fetchProjectSettings, saveProjectSettings, type AIProvider } from '../../../lib/studio-api';
import { getModelsFromProviders } from '../../../lib/model-options';
import { TIER_INFO, ROUTING_DEFAULTS } from './helpers.js';

interface ModelRoutingSectionProps {
	projectId: string;
}

export default function ModelRoutingSection({ projectId }: ModelRoutingSectionProps) {
	const [providers, setProviders] = useState<AIProvider[]>([]);
	const [config, setConfig] = useState<Record<string, string>>(ROUTING_DEFAULTS);
	const [original, setOriginal] = useState<Record<string, string>>(ROUTING_DEFAULTS);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [provs, settings] = await Promise.all([
				fetchProviders(),
				fetchProjectSettings(projectId),
			]);
			setProviders(provs);
			const overrides = settings?.model_routing ?? {};
			const merged = { ...ROUTING_DEFAULTS, ...overrides };
			setConfig(merged);
			setOriginal(merged);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Routing config yuklenemedi');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => { load(); }, [load]);

	const modelGroups = getModelsFromProviders(
		providers.map((p) => ({ type: p.type, model: p.model, isActive: p.isActive })),
	);

	const dirty = TIER_INFO.some((t) => config[t.key] !== original[t.key]);

	const handleSave = async () => {
		setSaving(true);
		setError(null);
		try {
			const payload: Record<string, string> = {};
			for (const t of TIER_INFO) payload[t.key] = config[t.key] ?? ROUTING_DEFAULTS[t.key];
			await saveProjectSettings(projectId, 'model_routing', payload);
			setOriginal(payload);
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Kaydedilemedi');
		} finally {
			setSaving(false);
		}
	};

	const handleReset = () => {
		setConfig({ ...ROUTING_DEFAULTS });
	};

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Cpu size={14} className="text-[#22c55e]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Model Routing</h3>
				<span className="ml-auto flex items-center gap-3">
					{saved && (
						<span className="flex items-center gap-1 text-[10px] text-[#22c55e]">
							<CheckCircle2 size={10} />
							Saved
						</span>
					)}
					<button
						type="button"
						onClick={handleReset}
						disabled={!dirty || saving}
						className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
						title="Default degerlere sifirla"
					>
						<RotateCcw size={10} />
						Reset
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={!dirty || saving}
						className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#22c55e] text-black font-medium rounded hover:bg-[#16a34a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
						Save
					</button>
				</span>
			</div>

			<div className="px-4 py-2">
				<p className="text-[10px] text-[#525252]">
					Task complexity'sine gore otomatik model secimi. Retry veya review reddinde
					tier bir ust seviyeye yukseltilir. Aktif olmayan provider modelleri hala secilebilir
					(provider aktiflestirildikten sonra calisir).
				</p>
			</div>

			{error && (
				<div className="mx-4 mb-2 flex items-center gap-2 px-2 py-1.5 bg-[#450a0a]/40 border border-[#7f1d1d] rounded text-[10px] text-[#f87171]">
					<AlertCircle size={10} />
					{error}
				</div>
			)}

			<div className="px-4 pb-4 space-y-2">
				{loading ? (
					<div className="flex justify-center py-6">
						<Loader2 size={14} className="animate-spin text-[#525252]" />
					</div>
				) : (
					TIER_INFO.map((tier) => {
						const value = config[tier.key] ?? ROUTING_DEFAULTS[tier.key];
						const isOverridden = value !== ROUTING_DEFAULTS[tier.key];
						return (
							<div key={tier.key} className="flex items-center gap-3 px-3 py-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded">
								<div className="w-14 shrink-0">
									<div className="flex items-center gap-1">
										<span className="text-[11px] font-semibold text-[#fafafa]">{tier.key}</span>
										{isOverridden && (
											<span className="w-1 h-1 rounded-full bg-[#22c55e]" title="Override aktif" />
										)}
									</div>
									<div className="text-[9px] text-[#525252]">{tier.label}</div>
								</div>
								<div className="flex-1 min-w-0">
									<div className="text-[10px] text-[#a3a3a3] mb-1">{tier.description}</div>
									<select
										value={value}
										onChange={(e) => setConfig({ ...config, [tier.key]: e.target.value })}
										className="w-full px-2 py-1.5 text-[11px] bg-[#0a0a0a] border border-[#262626] rounded text-[#fafafa] focus:outline-none focus:border-[#22c55e] font-mono"
									>
										{!modelGroups.some((g) => g.models.includes(value)) && value && (
											<option value={value}>{value} (custom)</option>
										)}
										{modelGroups.map((group) => (
											<optgroup key={group.label} label={group.label}>
												{group.models.map((m) => (
													<option key={m} value={m}>{m}</option>
												))}
											</optgroup>
										))}
									</select>
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
