import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import ApiErrorAlert from '../../components/ApiErrorAlert';
import ModalOverlay from './ModalOverlay';
import {
	approveApproval,
	getApprovalArtifactCompleteness,
	getApprovalState,
	getBlockingGates,
	getPendingApprovals,
	getReleaseState,
	rejectApproval,
	type ApprovalDecisionState,
	type PendingApprovalRequest,
} from '../../lib/studio-api/approvals';
import { StudioApiError } from '../../lib/studio-api/base';

type SortKey = 'age' | 'missing' | 'goal' | 'environment';

interface DetailBundle {
	approval: PendingApprovalRequest;
	approvalState: Awaited<ReturnType<typeof getApprovalState>>;
	releaseState: Awaited<ReturnType<typeof getReleaseState>>;
	blockers: Awaited<ReturnType<typeof getBlockingGates>>;
	artifactCompleteness: Awaited<ReturnType<typeof getApprovalArtifactCompleteness>>;
}

function getRequestAgeMinutes(createdAt: string): number {
	return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
}

function resolveEnvironment(metadata?: Record<string, unknown>): string {
	const raw = metadata?.environment;
	return typeof raw === 'string' ? raw : 'production';
}

function isActionable(state: string): boolean {
	return state === 'pending' || state === 'in-review';
}

export default function ApprovalQueuePage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [goalInput, setGoalInput] = useState(searchParams.get('goalId') ?? '');
	const [sortKey, setSortKey] = useState<SortKey>('age');
	const [loading, setLoading] = useState(false);
	const [mutating, setMutating] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [queue, setQueue] = useState<PendingApprovalRequest[]>([]);
	const [detail, setDetail] = useState<DetailBundle | null>(null);
	const [decisionNote, setDecisionNote] = useState('');
	const [rejectReason, setRejectReason] = useState('');
	const [confirmApprove, setConfirmApprove] = useState(false);
	const [confirmReject, setConfirmReject] = useState(false);
	const [mutationError, setMutationError] = useState<Error | null>(null);

	const activeGoalId = searchParams.get('goalId') ?? '';

	const loadQueue = useCallback(async () => {
		if (!activeGoalId) {
			setQueue([]);
			setDetail(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const pending = await getPendingApprovals(activeGoalId);
			setQueue(pending);
			setDetail((prev) => (prev && prev.approval.goalId === activeGoalId ? prev : null));
		} catch (err) {
			setError(err as Error);
			setQueue([]);
			setDetail(null);
		} finally {
			setLoading(false);
		}
	}, [activeGoalId]);

	useEffect(() => {
		void loadQueue();
	}, [loadQueue]);

	const sortedQueue = useMemo(() => {
		const data = [...queue];
		data.sort((a, b) => {
			if (sortKey === 'goal') return a.goalId.localeCompare(b.goalId);
			if (sortKey === 'environment') return resolveEnvironment(a.metadata).localeCompare(resolveEnvironment(b.metadata));
			if (sortKey === 'missing') {
				const ma = Number(a.metadata?.missingApprovals ?? 0);
				const mb = Number(b.metadata?.missingApprovals ?? 0);
				return mb - ma;
			}
			return getRequestAgeMinutes(b.createdAt) - getRequestAgeMinutes(a.createdAt);
		});
		return data;
	}, [queue, sortKey]);

	const guidance = useMemo(() => {
		if (!detail) return [];
		const items: string[] = [];
		if (detail.releaseState.rollbackRequired) {
			items.push('Rollback riski aktif; önce rollback trigger nedenini temizlemeden approve etme.');
		}
		if (detail.blockers.length > 0) {
			items.push('Blocking gate var; reject yerine önce gate fix sırasını netleştir.');
		}
		if (!detail.artifactCompleteness.satisfied) {
			items.push('Eksik artifact tamamlanmadan approve etmek release güvenini düşürür.');
		}
		if (detail.approvalState.blocked || detail.approvalState.rejected.length > 0) {
			items.push('Bu approval zaten bloke/rejected durumda; yeni kararın geçerli olup olmadığını doğrula.');
		}
		if (items.length === 0) {
			items.push('Risk sinyali yok; bağlamı teyit edip kontrollü approve uygulanabilir.');
		}
		return items;
	}, [detail]);

	const openDetail = useCallback(async (approval: PendingApprovalRequest) => {
		setLoading(true);
		setError(null);
		setMutationError(null);
		try {
			const [approvalState, releaseState, blockers, artifactCompleteness] = await Promise.all([
				getApprovalState(approval.goalId),
				getReleaseState(approval.goalId),
				getBlockingGates(approval.goalId),
				getApprovalArtifactCompleteness(approval.goalId),
			]);
			setDetail({ approval, approvalState, releaseState, blockers, artifactCompleteness });
			setConfirmApprove(false);
			setConfirmReject(false);
			setDecisionNote('');
			setRejectReason('');
		} catch (err) {
			setError(err as Error);
		} finally {
			setLoading(false);
		}
	}, []);

	const refreshAfterMutation = useCallback(
		async (goalId: string, selectedId: string) => {
			await loadQueue();
			const updated = await getPendingApprovals(goalId);
			const same = updated.find((x) => x.id === selectedId);
			if (same) await openDetail(same);
			else setDetail(null);
		},
		[loadQueue, openDetail],
	);

	const runDecision = useCallback(
		async (action: 'approve' | 'reject') => {
			if (!detail) return;
			setMutating(true);
			setMutationError(null);
			try {
				let decision: ApprovalDecisionState;
				if (action === 'approve') {
					decision = await approveApproval(detail.approval.id, {
						reason: decisionNote.trim(),
						metadata: { source: 'approval-queue-ui' },
					});
				} else {
					decision = await rejectApproval(detail.approval.id, {
						reason: rejectReason.trim(),
						metadata: { source: 'approval-queue-ui' },
					});
				}
				if (!decision) return;
				await refreshAfterMutation(detail.approval.goalId, detail.approval.id);
			} catch (err) {
				setMutationError(err as Error);
			} finally {
				setMutating(false);
			}
		},
		[decisionNote, detail, refreshAfterMutation, rejectReason],
	);

	const submitGoalFilter = () => {
		const next = goalInput.trim();
		setSearchParams(next ? { goalId: next } : {});
	};

	const errorStatus = error instanceof StudioApiError ? error.status : null;

	return (
		<div className="p-6 space-y-6" data-testid="approval-queue-page">
			<div className="flex items-end justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-xl font-semibold text-zinc-100">Human Review / Approval Queue</h1>
					<p className="text-sm text-zinc-400 mt-1">Operatör onay akışı, risk bağlamı ve güvenli karar yüzeyi.</p>
				</div>
				<Link to="/studio/control-plane" className="text-xs px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
					Control Plane
				</Link>
			</div>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
				<div className="flex flex-wrap items-end gap-2">
					<label className="text-xs text-zinc-400">
						Goal ID
						<input
							value={goalInput}
							onChange={(e) => setGoalInput(e.target.value)}
							placeholder="goal-123"
							className="mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
						/>
					</label>
					<button onClick={submitGoalFilter} className="text-xs px-3 py-2 rounded bg-zinc-800 text-zinc-100 hover:bg-zinc-700">
						Load Queue
					</button>
					<label className="text-xs text-zinc-400">
						Sort
						<select
							value={sortKey}
							onChange={(e) => setSortKey(e.target.value as SortKey)}
							className="mt-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
						>
							<option value="age">Request Age</option>
							<option value="missing">Missing Approvals</option>
							<option value="goal">Goal</option>
							<option value="environment">Environment</option>
						</select>
					</label>
				</div>
				<p className="text-xs text-zinc-500">Queue endpoint goal bazlıdır; tablo seçili goal için bekleyen approval kayıtlarını listeler.</p>
			</section>

			{loading ? (
				<div className="flex items-center gap-2 text-zinc-300" data-testid="approval-queue-loading">
					<Loader2 className="animate-spin" size={16} />
					Approval queue yükleniyor...
				</div>
			) : null}

			{error ? (
				<div data-testid={errorStatus === 403 ? 'approval-queue-error-403' : 'approval-queue-error-generic'}>
					<ApiErrorAlert error={error} onRetry={() => void loadQueue()} />
				</div>
			) : null}

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3" data-testid="approval-queue-table">
				<h2 className="text-sm font-medium text-zinc-200">Pending Approval Queue</h2>
				{!activeGoalId ? (
					<p className="text-sm text-zinc-400">Queue görüntülemek için bir goalId gir.</p>
				) : sortedQueue.length === 0 ? (
					<p className="text-sm text-zinc-400">Bu goal için pending approval yok.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full text-xs text-zinc-300">
							<thead className="border-b border-zinc-800 text-zinc-500">
								<tr>
									<th className="py-2 pr-3 text-left">goalId</th>
									<th className="py-2 pr-3 text-left">class</th>
									<th className="py-2 pr-3 text-left">env</th>
									<th className="py-2 pr-3 text-left">required quorum</th>
									<th className="py-2 pr-3 text-left">approved</th>
									<th className="py-2 pr-3 text-left">missing</th>
									<th className="py-2 pr-3 text-left">age</th>
									<th className="py-2 pr-3 text-left">reason</th>
									<th className="py-2 pr-3 text-left">owner</th>
									<th className="py-2 pr-3 text-left">release blocked</th>
									<th className="py-2 text-left">action</th>
								</tr>
							</thead>
							<tbody>
								{sortedQueue.map((item) => {
									const missingApprovals = Number(item.metadata?.missingApprovals ?? item.requiredQuorum);
									const approved = Math.max(0, item.requiredQuorum - missingApprovals);
									const env = resolveEnvironment(item.metadata);
									const critical = env === 'production' && missingApprovals > 0;
									return (
										<tr key={item.id} className={`border-b border-zinc-900 ${critical ? 'bg-red-950/20' : ''}`}>
											<td className="py-2 pr-3">{item.goalId}</td>
											<td className="py-2 pr-3">{item.approvalClass}</td>
											<td className="py-2 pr-3">{env}</td>
											<td className="py-2 pr-3">{item.requiredQuorum}</td>
											<td className="py-2 pr-3">{approved}</td>
											<td className="py-2 pr-3">{missingApprovals}</td>
											<td className="py-2 pr-3">{getRequestAgeMinutes(item.createdAt)}m</td>
											<td className="py-2 pr-3 truncate max-w-[180px]">{item.reason || '-'}</td>
											<td className="py-2 pr-3">{item.requestedBy}</td>
											<td className="py-2 pr-3">{missingApprovals > 0 ? 'yes' : 'no'}</td>
											<td className="py-2">
												<button onClick={() => void openDetail(item)} className="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800">
													Review
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{detail ? (
				<ModalOverlay onClose={() => setDetail(null)}>
					<div className="w-[900px] max-w-[96vw] max-h-[90vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-4">
						<div className="flex items-start justify-between">
							<div>
								<h2 className="text-lg text-zinc-100 font-semibold">Approval Detail</h2>
								<p className="text-xs text-zinc-400 mt-1">request: {detail.approval.id}</p>
							</div>
							<button onClick={() => setDetail(null)} className="text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800">
								Close
							</button>
						</div>

						{mutationError ? <ApiErrorAlert error={mutationError} onRetry={() => setMutationError(null)} /> : null}

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
							<section className="rounded border border-zinc-800 p-3 space-y-1">
								<h3 className="text-zinc-200 font-medium">Approval Summary</h3>
								<p className="text-zinc-400">goalId: {detail.approval.goalId}</p>
								<p className="text-zinc-400">class: {detail.approval.approvalClass}</p>
								<p className="text-zinc-400">quorum: {detail.approval.requiredQuorum}</p>
								<p className="text-zinc-400">state: {detail.approval.state}</p>
								<p className="text-zinc-400">expires: {(detail.approval.metadata?.expiresAt as string) ?? 'n/a'}</p>
								<p className="text-zinc-400">reason: {detail.approval.reason || '-'}</p>
							</section>
							<section className="rounded border border-zinc-800 p-3 space-y-1">
								<h3 className="text-zinc-200 font-medium">Release Impact</h3>
								<p className="text-zinc-400">allowed: {String(detail.releaseState.allowed)}</p>
								<p className="text-zinc-400">blocked: {String(detail.releaseState.blocked)}</p>
								<p className="text-zinc-400">requires override: {String(detail.releaseState.requiresOverride)}</p>
								<p className="text-zinc-400">rollback required: {String(detail.releaseState.rollbackRequired)}</p>
								<p className="text-zinc-400">blocking reasons: {detail.releaseState.blockingReasons.length}</p>
							</section>
						</div>

						<section className="rounded border border-zinc-800 p-3">
							<h3 className="text-zinc-200 font-medium mb-2">Blocking Gates</h3>
							{detail.blockers.length === 0 ? (
								<p className="text-sm text-zinc-400">Blocking gate yok.</p>
							) : (
								<ul className="text-sm text-zinc-400 space-y-1">
									{detail.blockers.map((b) => (
										<li key={`${b.gateType}-${b.reason}`}>
											{b.gateType} - {b.reason}
										</li>
									))}
								</ul>
							)}
						</section>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<section className="rounded border border-zinc-800 p-3 space-y-1">
								<h3 className="text-zinc-200 font-medium">Approval History</h3>
								<p className="text-sm text-zinc-400">approved actors: {detail.approvalState.states.flatMap((s) => s.approvedActorIds).join(', ') || 'none'}</p>
								<p className="text-sm text-zinc-400">rejected actors: {detail.approvalState.states.flatMap((s) => s.rejectedActorIds).join(', ') || 'none'}</p>
								<p className="text-sm text-zinc-400">expired requests: {detail.approvalState.expired.length}</p>
								<p className="text-sm text-zinc-400">superseded/rejected records: {detail.approvalState.rejected.length}</p>
							</section>
							<section className="rounded border border-zinc-800 p-3 space-y-1">
								<h3 className="text-zinc-200 font-medium">Artifact Completeness</h3>
								<p className="text-sm text-zinc-400">satisfied: {String(detail.artifactCompleteness.satisfied)}</p>
								<p className="text-sm text-zinc-400">
									missing: {detail.artifactCompleteness.missingArtifacts.join(', ') || 'none'}
								</p>
								<p className="text-sm text-zinc-400">rejected: {detail.artifactCompleteness.rejectedArtifacts.length}</p>
								<p className="text-sm text-zinc-400">stale: {detail.artifactCompleteness.staleArtifacts.length}</p>
							</section>
						</div>

						<section className="rounded border border-zinc-800 p-3">
							<h3 className="text-zinc-200 font-medium mb-2">Operator Guidance</h3>
							<ul className="space-y-1">
								{guidance.map((item) => (
									<li key={item} className="flex items-start gap-2 text-sm text-zinc-300">
										{item.toLowerCase().includes('rollback') ? <ShieldAlert size={14} className="text-red-300 mt-0.5" /> : null}
										{item.toLowerCase().includes('kontroll') ? <CheckCircle2 size={14} className="text-emerald-300 mt-0.5" /> : null}
										{!item.toLowerCase().includes('rollback') && !item.toLowerCase().includes('kontroll') ? (
											<AlertTriangle size={14} className="text-amber-300 mt-0.5" />
										) : null}
										<span>{item}</span>
									</li>
								))}
							</ul>
						</section>

						{!isActionable(detail.approval.state) ? (
							<div className="rounded border border-amber-700/50 bg-amber-900/20 p-3 text-sm text-amber-200" data-testid="approval-non-actionable">
								Bu approval artık aksiyonlanamaz (durum: {detail.approval.state}).
							</div>
						) : null}

						<section className="rounded border border-zinc-800 p-3 space-y-3">
							<h3 className="text-zinc-200 font-medium">Approve / Reject</h3>
							<p className="text-xs text-zinc-500">Approve hızlı ama kontrollü; reject için gerekçe zorunlu ve release bloklayabilir.</p>

							<label className="block text-xs text-zinc-400">
								Operator note (optional)
								<textarea
									value={decisionNote}
									onChange={(e) => setDecisionNote(e.target.value)}
									rows={2}
									className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
								/>
							</label>
							<label className="flex items-center gap-2 text-xs text-zinc-300">
								<input type="checkbox" checked={confirmApprove} onChange={(e) => setConfirmApprove(e.target.checked)} />
								Release impact bilgisini okudum, approve kararını bilinçli veriyorum.
							</label>
							<button
								onClick={() => void runDecision('approve')}
								disabled={!confirmApprove || mutating || !isActionable(detail.approval.state)}
								className="px-3 py-2 text-xs rounded bg-emerald-700/30 border border-emerald-600/40 text-emerald-200 disabled:opacity-50"
							>
								{mutating ? 'Approving...' : 'Confirm Approve'}
							</button>

							<div className="border-t border-zinc-800 pt-3 space-y-2">
								<label className="block text-xs text-zinc-400">
									Rejection reason (required)
									<textarea
										value={rejectReason}
										onChange={(e) => setRejectReason(e.target.value)}
										rows={3}
										className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
									/>
								</label>
								<label className="flex items-center gap-2 text-xs text-zinc-300">
									<input type="checkbox" checked={confirmReject} onChange={(e) => setConfirmReject(e.target.checked)} />
									Reject kararının release'i bloklayabileceğini anladım.
								</label>
								<button
									onClick={() => void runDecision('reject')}
									disabled={!confirmReject || !rejectReason.trim() || mutating || !isActionable(detail.approval.state)}
									className="px-3 py-2 text-xs rounded bg-red-700/30 border border-red-600/40 text-red-200 disabled:opacity-50"
								>
									{mutating ? 'Rejecting...' : 'Confirm Reject'}
								</button>
							</div>
						</section>
					</div>
				</ModalOverlay>
			) : null}
		</div>
	);
}
