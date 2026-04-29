import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { useWsEventRefresh } from '../../hooks/useWsEventRefresh';
import {
	Play,
	Square,
	Loader2,
	Terminal,
	Pencil,
	Trash2,
	Clock,
	MessageSquare,
} from 'lucide-react';
import type { ProjectAgent } from '../../lib/studio-api';
import AgentAvatar from '../../components/AgentAvatar';
import {
	startAgentProcess,
	stopAgentProcess,
	getAgentStatus,
	getAgentRunHistory,
	fetchUnreadCount,
	type AgentProcessInfo,
	type AgentRunHistory,
	roleLabel,
} from '../../lib/studio-api';
import { AGENT_CARD_WS_EVENTS, STATUS_STYLES, type RuntimeStatus } from './agent-card/index.js';
import HistoryPanel from './agent-card/history-panel.js';
import SkillsList from './agent-card/skills-list.js';
import EmbeddedTerminal from './agent-card/embedded-terminal.js';

function AgentCard({
	agent,
	projectId,
	status: externalStatus,
	onStart,
	onStop,
	onClick,
	onEdit,
	onDelete,
	onChat,
}: {
	agent: ProjectAgent;
	projectId: string;
	status: RuntimeStatus;
	onStart: () => Promise<void>;
	onStop: () => Promise<void>;
	onClick?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onChat?: () => void;
}) {
	const [showTerminal, setShowTerminal] = useState(false);
	const [actionLoading, setActionLoading] = useState(false);
	const [processInfo, setProcessInfo] = useState<AgentProcessInfo | null>(null);
	const [runHistory, setRunHistory] = useState<AgentRunHistory[]>([]);
	const [showHistory, setShowHistory] = useState(false);
	const [historyLoading, setHistoryLoading] = useState(false);
	const historyRef = useRef<HTMLDivElement>(null);
	const [unreadCount, setUnreadCount] = useState(0);

	const status = actionLoading
		? externalStatus === 'running'
			? 'stopping'
			: 'starting'
		: externalStatus;
	const s = STATUS_STYLES[status] ?? STATUS_STYLES.idle;
	const isRunning = externalStatus === 'running';

	const handleAction = async () => {
		setActionLoading(true);
		try {
			if (isRunning) {
				await stopAgentProcess(projectId, agent.id);
				await onStop();
				setProcessInfo(null);
			} else {
				const info = await startAgentProcess(projectId, agent.id);
				setProcessInfo(info);
				await onStart();
			}
		} catch {
			// Hata durumunu üst bileşen yönetir
		} finally {
			setActionLoading(false);
		}
	};

	const pollAgentStatus = useCallback(async () => {
		try {
			const info = await getAgentStatus(projectId, agent.id);
			setProcessInfo(info);
		} catch {
			// Polling hatalarını sessizce atla
		}
	}, [projectId, agent.id]);

	const { isWsActive } = useWsEventRefresh(projectId, AGENT_CARD_WS_EVENTS, pollAgentStatus, {
		debounceMs: 300,
		enabled: isRunning,
	});

	useEffect(() => {
		if (!isRunning) return;
		pollAgentStatus();
		if (isWsActive) return;
		const interval = setInterval(pollAgentStatus, 3000);
		return () => clearInterval(interval);
	}, [projectId, agent.id, isRunning, isWsActive, pollAgentStatus]);

	useEffect(() => {
		if (!isRunning) setShowTerminal(false);
	}, [isRunning]);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const res = await fetchUnreadCount(projectId, agent.id);
				if (!cancelled) setUnreadCount(res.unreadCount);
			} catch {
				// Sayaç yüklenemezse sessizce geç
			}
		};
		load();
		const interval = setInterval(load, 15000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [projectId, agent.id]);

	useEffect(() => {
		if (!showHistory) return;
		const handler = (e: MouseEvent) => {
			if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
				setShowHistory(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [showHistory]);

	const handleToggleHistory = useCallback(async () => {
		if (showHistory) {
			setShowHistory(false);
			return;
		}
		setShowHistory(true);
		setHistoryLoading(true);
		try {
			const history = await getAgentRunHistory(projectId, agent.id, 5);
			setRunHistory(history);
		} catch {
			setRunHistory([]);
		} finally {
			setHistoryLoading(false);
		}
	}, [showHistory, projectId, agent.id]);

	return (
		<div
			className={`bg-[#111111] border border-[#262626] border-l-4 rounded-xl overflow-hidden ${onClick ? 'hover:border-[#333] transition-colors' : ''}`}
			style={{ borderLeftColor: agent.color ?? '#22c55e' }}
		>
			{/* Kart ana satırı */}
			<div
				className={`flex items-center gap-3 px-4 py-3 ${onClick ? 'cursor-pointer' : ''}`}
				onClick={onClick}
			>
				{/* Avatar */}
				<div className="relative shrink-0">
					<AgentAvatar avatar={agent.avatar} name={agent.name} size="lg" />
					{unreadCount > 0 && (
						<span
							className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#ef4444] text-[#fafafa] text-[8px] font-bold flex items-center justify-center leading-none"
							title={`${unreadCount} okunmamış mesaj`}
						>
							{unreadCount > 9 ? '9+' : unreadCount}
						</span>
					)}
				</div>

				{/* Ajan bilgisi */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[13px] font-semibold text-[#fafafa] truncate">{agent.name}</span>
						<div className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} title={s.label} />
						<span
							className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${
								agent.sourceAgentId
									? 'bg-[#a3a3a3]/10 text-[#525252] border border-[#333]'
									: 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
							}`}
						>
							{agent.sourceAgentId ? 'Template' : 'Custom'}
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[11px] text-[#525252] truncate">{roleLabel(agent.role)}</span>
						{processInfo?.pid && (
							<span className="text-[10px] font-mono text-[#3b82f6] shrink-0">PID {processInfo.pid}</span>
						)}
					</div>
				</div>

				{/* Eylem butonları */}
				<div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
					{onChat && (
						<button
							onClick={onChat}
							className="p-1.5 rounded-lg text-[#525252] hover:text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
							title="Ajan ile sohbet et"
						>
							<MessageSquare size={13} />
						</button>
					)}
					{onEdit && (
						<button
							onClick={onEdit}
							className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
							title="Edit agent"
						>
							<Pencil size={13} />
						</button>
					)}
					{onDelete && (
						<button
							onClick={onDelete}
							className="p-1.5 rounded-lg text-[#525252] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
							title="Delete agent"
						>
							<Trash2 size={13} />
						</button>
					)}

					{/* Geçiş açılır menüsü */}
					<div className="relative" ref={historyRef}>
						<button
							onClick={handleToggleHistory}
							className={`p-1.5 rounded-lg transition-colors text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] ${
								showHistory ? 'bg-[#1f1f1f] text-[#a3a3a3]' : ''
							}`}
							title="Run history"
						>
							<Clock size={13} />
						</button>
						<HistoryPanel
							show={showHistory}
							loading={historyLoading}
							history={runHistory}
							ref={historyRef}
							onClose={() => setShowHistory(false)}
						/>
					</div>

					{/* Terminal aç/kapat */}
					{isRunning && (
						<button
							onClick={() => setShowTerminal(!showTerminal)}
							className={`p-1.5 rounded-lg text-[#525252] hover:text-[#22c55e] hover:bg-[#1f1f1f] transition-colors ${
								showTerminal ? 'bg-[#1f1f1f] text-[#22c55e]' : ''
							}`}
							title="Terminal aç/kapat"
						>
							<Terminal size={14} />
						</button>
					)}

					{/* Başlat / Durdur butonu */}
					<button
						onClick={handleAction}
						disabled={actionLoading}
						className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
							isRunning
								? 'text-[#ef4444] hover:bg-[#ef4444]/10'
								: 'text-[#22c55e] hover:bg-[#22c55e]/10'
						}`}
						title={isRunning ? 'Durdur' : 'Başlat'}
					>
						{actionLoading ? (
							<Loader2 size={14} className="animate-spin" />
						) : isRunning ? (
							<Square size={14} />
						) : (
							<Play size={14} />
						)}
					</button>
				</div>
			</div>

			<SkillsList skills={agent.skills} />

			<EmbeddedTerminal
				projectId={projectId}
				agentId={agent.id}
				agentName={agent.name}
				agentAvatar={agent.avatar}
				show={showTerminal && isRunning}
				onClose={() => setShowTerminal(false)}
			/>
		</div>
	);
}

export default memo(AgentCard);
