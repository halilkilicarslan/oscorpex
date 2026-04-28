import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
	fetchCLIUsageProviders,
	fetchCLIProbeEvents,
	fetchCLIUsageHistory,
	refreshCLIUsageProviders,
	refreshCLIUsageProvider,
	updateCLIUsageSettings,
	type CLIProviderId,
	type CLIUsageSnapshot,
	type CLIUsageTrendPoint,
	type CLIProbeEvent,
} from '../../lib/studio-api';
import {
	ProviderCard,
	GlobalTab,
	OscorpexTab,
	AttributionTab,
	HistoryTab,
	SettingsTab,
	STATUS_STYLE,
	statusIcon,
	fmtMoney,
	worstStatus,
} from './cli-usage-monitor';

type Tab = 'global' | 'oscorpex' | 'attribution' | 'history' | 'settings';

export default function CLIUsageMonitorPage() {
	const [providers, setProviders] = useState<CLIUsageSnapshot[]>([]);
	const [selectedId, setSelectedId] = useState<CLIProviderId>('claude');
	const [activeTab, setActiveTab] = useState<Tab>('global');
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState<string | null>(null);
	const [refreshingAll, setRefreshingAll] = useState(false);
	const [history, setHistory] = useState<CLIUsageTrendPoint[]>([]);
	const [events, setEvents] = useState<CLIProbeEvent[]>([]);

	const load = async () => {
		setLoading(true);
		try {
			const [data, trendData, eventData] = await Promise.all([
				fetchCLIUsageProviders(),
				fetchCLIUsageHistory(undefined, 100).catch(() => []),
				fetchCLIProbeEvents(undefined, 80).catch(() => []),
			]);
			setProviders(data);
			setHistory(trendData);
			setEvents(eventData);
			if (!data.some((provider) => provider.providerId === selectedId) && data[0]) {
				setSelectedId(data[0].providerId);
			}
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load().catch(() => setLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const selected = useMemo(
		() => providers.find((provider) => provider.providerId === selectedId) ?? providers[0],
		[providers, selectedId],
	);

	const installedCount = providers.filter((provider) => provider.installed).length;
	const connectedCount = providers.filter((provider) => provider.authStatus === 'connected').length;
	const todayCost = providers.reduce((sum, provider) => sum + provider.oscorpex.todayCostUsd, 0);
	const overallStatus = worstStatus(providers);

	const handleRefresh = async (providerId: CLIProviderId) => {
		setRefreshing(providerId);
		try {
			const updated = await refreshCLIUsageProvider(providerId);
			setProviders((prev) => prev.map((item) => (item.providerId === providerId ? updated : item)));
			const [trendData, eventData] = await Promise.all([
				fetchCLIUsageHistory(undefined, 100).catch(() => history),
				fetchCLIProbeEvents(undefined, 80).catch(() => events),
			]);
			setHistory(trendData);
			setEvents(eventData);
		} finally {
			setRefreshing(null);
		}
	};

	const handleRefreshAll = async () => {
		setRefreshingAll(true);
		try {
			const data = await refreshCLIUsageProviders();
			const [trendData, eventData] = await Promise.all([
				fetchCLIUsageHistory(undefined, 100).catch(() => history),
				fetchCLIProbeEvents(undefined, 80).catch(() => events),
			]);
			setProviders(data);
			setHistory(trendData);
			setEvents(eventData);
		} finally {
			setRefreshingAll(false);
		}
	};

	const handleSettings = async (
		providerId: CLIProviderId,
		patch: Partial<CLIUsageSnapshot['permissions']>,
	) => {
		const permissions = await updateCLIUsageSettings(providerId, patch);
		setProviders((prev) =>
			prev.map((item) => (item.providerId === providerId ? { ...item, permissions } : item)),
		);
	};

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 size={24} className="animate-spin text-[#525252]" />
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-y-auto bg-[#0a0a0a] p-6 text-[#fafafa]">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold">CLI Usage Monitor</h1>
					<p className="mt-1 text-[13px] text-[#737373]">
						Global CLI quota durumunu ve Oscorpex token/cost tüketimini tek yerden izle.
					</p>
				</div>
				<button
					type="button"
					onClick={handleRefreshAll}
					disabled={refreshingAll}
					className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-[#a3a3a3] hover:border-[#333] hover:text-[#fafafa]"
				>
					{refreshingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
					Refresh enabled probes
				</button>
			</div>

			<div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
					<div className="text-[10px] uppercase tracking-wider text-[#525252]">Installed CLIs</div>
					<div className="mt-2 text-2xl font-bold">
						{installedCount}/{providers.length}
					</div>
				</div>
				<div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
					<div className="text-[10px] uppercase tracking-wider text-[#525252]">Connected</div>
					<div className="mt-2 text-2xl font-bold">{connectedCount}</div>
				</div>
				<div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
					<div className="text-[10px] uppercase tracking-wider text-[#525252]">Worst quota</div>
					<div
						className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] ${STATUS_STYLE[overallStatus]}`}
					>
						{statusIcon(overallStatus)}
						{overallStatus}
					</div>
				</div>
				<div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
					<div className="text-[10px] uppercase tracking-wider text-[#525252]">Oscorpex today</div>
					<div className="mt-2 text-2xl font-bold">{fmtMoney(todayCost)}</div>
				</div>
			</div>

			<div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
				<div className="grid gap-3">
					{providers.map((provider) => (
						<ProviderCard
							key={provider.providerId}
							provider={provider}
							selected={selected?.providerId === provider.providerId}
							onSelect={() => setSelectedId(provider.providerId)}
							onRefresh={() => handleRefresh(provider.providerId)}
						/>
					))}
				</div>

				{selected && (
					<div className="rounded-3xl border border-[#262626] bg-[#111111]">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] px-5 py-4">
							<div>
								<div className="text-[16px] font-semibold">{selected.label}</div>
								<div className="mt-1 text-[11px] text-[#525252]">
									Last checked: {new Date(selected.lastCheckedAt).toLocaleString()}
								</div>
							</div>
							<button
								type="button"
								onClick={() => handleRefresh(selected.providerId)}
								disabled={refreshing === selected.providerId}
								className="inline-flex items-center gap-2 rounded-xl bg-[#22c55e]/10 px-3 py-2 text-[12px] font-medium text-[#22c55e] hover:bg-[#22c55e]/20 disabled:opacity-40"
							>
								{refreshing === selected.providerId ? (
									<Loader2 size={14} className="animate-spin" />
								) : (
									<RefreshCw size={14} />
								)}
								Refresh provider
							</button>
						</div>

						<div className="flex gap-1 border-b border-[#262626] px-4 py-2">
							{(['global', 'oscorpex', 'attribution', 'history', 'settings'] as Tab[]).map((tab) => (
								<button
									key={tab}
									type="button"
									onClick={() => setActiveTab(tab)}
									className={`rounded-xl px-3 py-2 text-[12px] font-medium capitalize transition-colors ${
										activeTab === tab
											? 'bg-[#22c55e]/10 text-[#22c55e]'
											: 'text-[#737373] hover:text-[#fafafa]'
									}`}
								>
									{tab === 'oscorpex' ? 'Oscorpex Usage' : tab}
								</button>
							))}
						</div>

						<div className="p-5">
							{activeTab === 'global' && <GlobalTab selected={selected} />}
							{activeTab === 'oscorpex' && <OscorpexTab selected={selected} />}
							{activeTab === 'attribution' && <AttributionTab selected={selected} />}
							{activeTab === 'history' && (
								<HistoryTab selected={selected} history={history} events={events} />
							)}
							{activeTab === 'settings' && (
								<SettingsTab selected={selected} onSettingsChange={handleSettings} />
							)}

							{selected.errors.length > 0 && (
								<div className="mt-5 rounded-2xl border border-[#262626] bg-[#0a0a0a] p-4">
									<div className="mb-2 text-[12px] font-medium text-[#fafafa]">Probe notes</div>
									<ul className="space-y-1 text-[11px] text-[#737373]">
										{selected.errors.map((error, index) => (
											<li key={`${error}-${index}`}>- {error}</li>
										))}
									</ul>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
