// ---------------------------------------------------------------------------
// Oscorpex — Project Settings (refactored)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import {
	fetchProjectSettings,
	saveProjectSettings,
	fetchProjectCosts,
	type SettingsMap,
	type ProjectCostSummary,
} from '../../lib/studio-api';
import { WIDGETS } from './settings/widgets.js';
import { MemorySection } from './settings/MemorySection.js';
import {
	WidgetCard,
	WebhookSection,
	ApprovalKeywordsSection,
	PolicySection,
	ModelRoutingSection,
	BudgetStatusBar,
} from './project-settings/index.js';

interface Props {
	projectId: string;
}

export default function ProjectSettings({ projectId }: Props) {
	const [, setSettings] = useState<SettingsMap>({});
	const [local, setLocal] = useState<SettingsMap>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [savingCategory, setSavingCategory] = useState<string | null>(null);
	const [savedCategory, setSavedCategory] = useState<string | null>(null);
	const [costSummary, setCostSummary] = useState<ProjectCostSummary | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [data, costsResult] = await Promise.allSettled([
				fetchProjectSettings(projectId),
				fetchProjectCosts(projectId),
			]);

			const settingsData = data.status === 'fulfilled' ? data.value : {};
			setSettings(settingsData);
			if (costsResult.status === 'fulfilled') setCostSummary(costsResult.value);

			const localMap: SettingsMap = {};
			for (const widget of WIDGETS) {
				localMap[widget.category] = {};
				for (const field of widget.fields) {
					localMap[widget.category][field.key] =
						settingsData[widget.category]?.[field.key] ?? field.defaultValue;
				}
			}
			setLocal(localMap);

			if (data.status === 'rejected') throw data.reason;
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Ayarlar yuklenemedi');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		load();
	}, [load]);

	const handleChange = (category: string, key: string, value: string) => {
		setLocal((prev) => ({
			...prev,
			[category]: { ...prev[category], [key]: value },
		}));
		if (savedCategory === category) setSavedCategory(null);
	};

	const handleSave = async (category: string) => {
		setSavingCategory(category);
		try {
			await saveProjectSettings(projectId, category, local[category] || {});
			setSavedCategory(category);
			setTimeout(() => setSavedCategory((prev) => (prev === category ? null : prev)), 2000);
		} catch {
			setError(`${category} kaydedilemedi`);
		} finally {
			setSavingCategory(null);
		}
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center py-20">
				<Loader2 size={20} className="animate-spin text-[#525252]" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-[14px] font-semibold text-[#fafafa]">Proje Ayarlari</h2>
					<p className="text-[11px] text-[#525252] mt-0.5">Entegrasyonlari ve arac ayarlarini yonetin</p>
				</div>
			</div>

			{error && (
				<div className="flex items-center gap-2 px-3 py-2 bg-[#450a0a]/40 border border-[#7f1d1d] rounded-lg text-[11px] text-[#f87171]">
					<AlertCircle size={12} />
					{error}
				</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{WIDGETS.map((widget) => {
					const isBudget = widget.category === 'budget';
					const budgetValues = local['budget'] || {};
					const budgetEnabled = budgetValues['enabled'] === 'true';
					const maxCostUsd = parseFloat(budgetValues['maxCostUsd'] || '0');
					const warningThreshold = parseFloat(budgetValues['warningThreshold'] || '0');
					const showBudgetBar =
						isBudget && budgetEnabled && maxCostUsd > 0 && costSummary !== null;

					return (
						<div key={widget.category}>
							<WidgetCard
								widget={widget}
								values={local[widget.category] || {}}
								onChange={(key, value) => handleChange(widget.category, key, value)}
								onSave={() => handleSave(widget.category)}
								saving={savingCategory === widget.category}
								saved={savedCategory === widget.category}
							/>
							{showBudgetBar && costSummary && (
								<div className="px-4 pb-3 -mt-1 bg-[#111111] border border-[#262626] border-t-0 rounded-b-xl mx-0">
									<BudgetStatusBar
										currentCost={costSummary.totalCostUsd}
										maxCost={maxCostUsd}
										warningThreshold={warningThreshold > 0 ? warningThreshold : undefined}
									/>
								</div>
							)}
						</div>
					);
				})}
			</div>

			<WebhookSection projectId={projectId} />
			<ApprovalKeywordsSection projectId={projectId} />
			<PolicySection projectId={projectId} />
			<ModelRoutingSection projectId={projectId} />
			<MemorySection projectId={projectId} />
		</div>
	);
}
