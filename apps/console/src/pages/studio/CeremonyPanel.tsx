import { useState, useEffect, useCallback } from 'react';
import { Loader2, PlayCircle } from 'lucide-react';
import {
	parseStandup,
	parseRetro,
	fetchCeremony,
	StandupView,
	RetroView,
	type Tab,
} from './ceremony-panel/index.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export default function CeremonyPanel({ projectId }: { projectId: string }) {
	const [tab, setTab] = useState<Tab>('standup');
	const [standup, setStandup] = useState<import('./ceremony-panel/types.js').StandupResult | null>(null);
	const [retro, setRetro] = useState<import('./ceremony-panel/types.js').RetroResult | null>(null);
	const [loadingStandup, setLoadingStandup] = useState(false);
	const [loadingRetro, setLoadingRetro] = useState(false);
	const [running, setRunning] = useState<Tab | null>(null);
	const [standupTried, setStandupTried] = useState(false);
	const [retroTried, setRetroTried] = useState(false);

	const loadStandup = useCallback(async () => {
		setLoadingStandup(true);
		setStandupTried(true);
		const result = await fetchCeremony(
			`${BASE}/api/studio/projects/${projectId}/ceremonies/standup`,
			parseStandup,
		);
		if (result) setStandup(result);
		setLoadingStandup(false);
	}, [projectId]);

	const loadRetro = useCallback(async () => {
		setLoadingRetro(true);
		setRetroTried(true);
		const result = await fetchCeremony(
			`${BASE}/api/studio/projects/${projectId}/ceremonies/retrospective`,
			parseRetro,
		);
		if (result) setRetro(result);
		setLoadingRetro(false);
	}, [projectId]);

	useEffect(() => {
		if (tab === 'standup' && !standup && !loadingStandup && !standupTried) loadStandup();
		if (tab === 'retro' && !retro && !loadingRetro && !retroTried) loadRetro();
	}, [tab, standup, retro, loadingStandup, loadingRetro, standupTried, retroTried, loadStandup, loadRetro]);

	const runStandup = async () => {
		setRunning('standup');
		const result = await fetchCeremony(
			`${BASE}/api/studio/projects/${projectId}/ceremonies/standup`,
			parseStandup,
			'POST',
		);
		if (result) setStandup(result);
		setRunning(null);
	};

	const runRetro = async () => {
		setRunning('retro');
		const result = await fetchCeremony(
			`${BASE}/api/studio/projects/${projectId}/ceremonies/retrospective`,
			parseRetro,
			'POST',
		);
		if (result) setRetro(result);
		setRunning(null);
	};

	const isLoading = (tab === 'standup' ? loadingStandup : loadingRetro) && !(tab === 'standup' ? standup : retro);

	return (
		<div className="flex flex-col h-full p-5 gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-[15px] font-semibold text-[#fafafa]">Ceremonies</h2>
					<p className="text-[11px] text-[#525252] mt-0.5">Scrum ceremony results</p>
				</div>
				<div className="flex items-center gap-2">
					{tab === 'standup' && (
						<button
							type="button"
							onClick={runStandup}
							disabled={running === 'standup'}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors disabled:opacity-50"
						>
							{running === 'standup' ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
							{running === 'standup' ? 'Running...' : 'Run Standup'}
						</button>
					)}
					{tab === 'retro' && (
						<button
							type="button"
							onClick={runRetro}
							disabled={running === 'retro'}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[#a855f7]/10 border border-[#a855f7]/30 text-[#a855f7] hover:bg-[#a855f7]/20 transition-colors disabled:opacity-50"
						>
							{running === 'retro' ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
							{running === 'retro' ? 'Running...' : 'Run Retrospective'}
						</button>
					)}
				</div>
			</div>

			<div className="flex gap-1 bg-[#111111] border border-[#262626] rounded-lg p-1 w-fit">
				<button
					type="button"
					onClick={() => setTab('standup')}
					className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
						tab === 'standup'
							? 'bg-[#1a1a1a] text-[#fafafa] shadow-sm'
							: 'text-[#525252] hover:text-[#a3a3a3]'
					}`}
				>
					Standup
				</button>
				<button
					type="button"
					onClick={() => setTab('retro')}
					className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
						tab === 'retro'
							? 'bg-[#1a1a1a] text-[#fafafa] shadow-sm'
							: 'text-[#525252] hover:text-[#a3a3a3]'
					}`}
				>
					Retrospective
				</button>
			</div>

			<div className="flex-1 overflow-y-auto">
				{isLoading ? (
					<div className="flex items-center justify-center h-48">
						<Loader2 size={20} className="text-[#525252] animate-spin" />
					</div>
				) : tab === 'standup' ? (
					<StandupView data={standup} />
				) : (
					<RetroView data={retro} />
				)}
			</div>
		</div>
	);
}
