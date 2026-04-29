import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import ApiErrorAlert from '../../components/ApiErrorAlert';
import ModalOverlay from './ModalOverlay';
import {
	applyManualOverride,
	evaluateRelease,
	getApprovalState,
	getArtifactCompleteness,
	getBlockingGates,
	getQualityGateReadiness,
	getReleaseState,
	triggerRollback,
	type ReleaseDecisionResult,
} from '../../lib/studio-api/releases';
import { StudioApiError } from '../../lib/studio-api/base';

interface PanelData {
	releaseState: Awaited<ReturnType<typeof getReleaseState>>;
	blockers: Awaited<ReturnType<typeof getBlockingGates>>;
	approvalState: Awaited<ReturnType<typeof getApprovalState>>;
	artifactCompleteness: Awaited<ReturnType<typeof getArtifactCompleteness>>;
	readiness: Awaited<ReturnType<typeof getQualityGateReadiness>>;
}

function isFuture(value: string): boolean {
	return new Date(value).getTime() > Date.now();
}

function getOverrideCandidates(data: PanelData) {
	return data.blockers.filter((b) => b.overrideAllowed);
}

export default function ReleaseDecisionPanelPage() {
	const { goalId } = useParams<{ goalId: string }>();
	const [loading, setLoading] = useState(true);
	const [mutating, setMutating] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [mutationError, setMutationError] = useState<Error | null>(null);
	const [data, setData] = useState<PanelData | null>(null);
	const [decisionResult, setDecisionResult] = useState<ReleaseDecisionResult | null>(null);
	const [overrideReason, setOverrideReason] = useState('');
	const [overrideExpiresAt, setOverrideExpiresAt] = useState('');
	const [overrideGateEvaluationId, setOverrideGateEvaluationId] = useState('');
	const [overrideCandidateId, setOverrideCandidateId] = useState('');
	const [overrideConfirm, setOverrideConfirm] = useState(false);
	const [rollbackReason, setRollbackReason] = useState('');
	const [rollbackConfirm, setRollbackConfirm] = useState(false);

	const load = useCallback(async () => {
		if (!goalId) return;
		setLoading(true);
		setError(null);
		try {
			const [releaseState, blockers, approvalState, artifactCompleteness, readiness] = await Promise.all([
				getReleaseState(goalId),
				getBlockingGates(goalId),
				getApprovalState(goalId),
				getArtifactCompleteness(goalId),
				getQualityGateReadiness(goalId),
			]);
			setData({ releaseState, blockers, approvalState, artifactCompleteness, readiness });
			setDecisionResult(null);
		} catch (err) {
			setError(err as Error);
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [goalId]);

	useEffect(() => {
		void load();
	}, [load]);

	const hardFailReasons = useMemo(() => {
		if (!data) return [];
		return data.releaseState.blockingReasons.filter((x) => x.overrideAllowed === false);
	}, [data]);

	const overrideCandidates = useMemo(() => (data ? getOverrideCandidates(data) : []), [data]);
	const canOverride = Boolean(data?.releaseState.requiresOverride && overrideCandidates.length > 0 && hardFailReasons.length === 0);

	const guidance = useMemo(() => {
		if (!data) return [];
		const items: string[] = [];
		if (data.releaseState.rollbackRequired) items.push('Rollback required aktif: önce rollback triage yap, sonra release kararına dön.');
		if (hardFailReasons.length > 0) items.push('Hard-fail blocker var: manual override yasak, gate düzeltmesi zorunlu.');
		if (!data.approvalState.satisfied) items.push('Onaylar tamamlanmamış: override öncesi approval kapanmalı.');
		if (!data.artifactCompleteness.satisfied) items.push('Artifact completeness eksik: release explainability yetersiz.');
		if (canOverride) items.push('Override teknik olarak mümkün: süreli ve gerekçeli, minimum riskle uygula.');
		if (items.length === 0) items.push('Release değerlendirmesi temiz görünüyor: evaluate ile son durumu doğrula.');
		return items;
	}, [canOverride, data, hardFailReasons.length]);

	const runEvaluate = useCallback(async () => {
		if (!goalId) return;
		setMutating(true);
		setMutationError(null);
		try {
			const result = await evaluateRelease(goalId);
			setDecisionResult(result);
			await load();
		} catch (err) {
			setMutationError(err as Error);
		} finally {
			setMutating(false);
		}
	}, [goalId, load]);

	const runOverride = useCallback(async () => {
		if (!goalId) return;
		setMutating(true);
		setMutationError(null);
		try {
			const result = await applyManualOverride(goalId, {
				releaseCandidateId: overrideCandidateId,
				gateEvaluationId: overrideGateEvaluationId,
				reason: overrideReason.trim(),
				expiresAt: overrideExpiresAt,
				metadata: { source: 'release-decision-panel-ui' },
			});
			setDecisionResult(result);
			await load();
		} catch (err) {
			setMutationError(err as Error);
		} finally {
			setMutating(false);
		}
	}, [goalId, load, overrideCandidateId, overrideExpiresAt, overrideGateEvaluationId, overrideReason]);

	const runRollback = useCallback(async () => {
		if (!goalId || !data?.releaseState.latestDecision?.releaseCandidateId) return;
		setMutating(true);
		setMutationError(null);
		try {
			await triggerRollback(goalId, {
				releaseCandidateId: data.releaseState.latestDecision.releaseCandidateId,
				triggerType: 'operator_manual',
				severity: data.releaseState.rollbackRequired ? 'critical' : 'high',
				source: 'release-panel',
				reason: rollbackReason.trim(),
				metadata: { source: 'release-decision-panel-ui' },
			});
			await load();
		} catch (err) {
			setMutationError(err as Error);
		} finally {
			setMutating(false);
		}
	}, [data?.releaseState.latestDecision?.releaseCandidateId, data?.releaseState.rollbackRequired, goalId, load, rollbackReason]);

	if (!goalId) return <div className="p-6 text-zinc-300">Geçersiz goalId.</div>;

	if (loading) {
		return (
			<div className="p-6 flex items-center gap-2 text-zinc-300" data-testid="release-panel-loading">
				<Loader2 size={16} className="animate-spin" />
				Release decision panel yükleniyor...
			</div>
		);
	}

	if (error) {
		const status = error instanceof StudioApiError ? error.status : null;
		return (
			<div className="p-6" data-testid={status === 403 ? 'release-panel-error-403' : 'release-panel-error'}>
				<ApiErrorAlert error={error} onRetry={() => void load()} />
			</div>
		);
	}

	if (!data) return <div className="p-6 text-zinc-400">Release state bulunamadı.</div>;

	const latest = data.releaseState.latestDecision;
	const decisionSource = data.releaseState.requiresOverride ? 'override-required' : data.releaseState.blocked ? 'blocked' : 'ready';
	const overrideDisabled =
		!canOverride ||
		!overrideConfirm ||
		!overrideReason.trim() ||
		!overrideExpiresAt ||
		!isFuture(overrideExpiresAt) ||
		!overrideGateEvaluationId ||
		!overrideCandidateId ||
		mutating;

	const rollbackDisabled =
		!rollbackConfirm || !rollbackReason.trim() || !data.releaseState.latestDecision?.releaseCandidateId || mutating;

	return (
		<div className="p-6 space-y-6" data-testid="release-decision-panel-page">
			<div className="flex items-end justify-between">
				<div>
					<h1 className="text-xl text-zinc-100 font-semibold">Manual Override + Release Decision Panel</h1>
					<p className="text-sm text-zinc-400 mt-1">Goal: {goalId}</p>
				</div>
				<div className="flex gap-2">
					<Link to={`/studio/quality-gates/${goalId}`} className="text-xs px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
						Quality Gates
					</Link>
					<button onClick={() => void load()} className="text-xs px-3 py-2 rounded bg-zinc-800 text-zinc-100 hover:bg-zinc-700">
						Refresh
					</button>
				</div>
			</div>

			{mutationError ? <ApiErrorAlert error={mutationError} onRetry={() => setMutationError(null)} /> : null}

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4" data-testid="release-summary">
				<h2 className="text-sm font-medium text-zinc-200 mb-3">Release Decision Summary</h2>
				<div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
					<div><span className="text-zinc-500">allowed</span><p className="text-zinc-100">{String(data.releaseState.allowed)}</p></div>
					<div><span className="text-zinc-500">blocked</span><p className="text-zinc-100">{String(data.releaseState.blocked)}</p></div>
					<div><span className="text-zinc-500">requiresOverride</span><p className="text-zinc-100">{String(data.releaseState.requiresOverride)}</p></div>
					<div><span className="text-zinc-500">rollbackRequired</span><p className="text-zinc-100">{String(data.releaseState.rollbackRequired)}</p></div>
					<div><span className="text-zinc-500">environment</span><p className="text-zinc-100">{data.readiness.environment}</p></div>
					<div><span className="text-zinc-500">latest decision</span><p className="text-zinc-100">{latest?.decision ?? 'none'}</p></div>
					<div><span className="text-zinc-500">blocking reasons</span><p className="text-zinc-100">{data.releaseState.blockingReasons.length}</p></div>
					<div><span className="text-zinc-500">decision source</span><p className="text-zinc-100">{decisionSource}</p></div>
					<div><span className="text-zinc-500">last evaluation</span><p className="text-zinc-100">{latest?.createdAt ?? 'n/a'}</p></div>
				</div>
				<div className="mt-3">
					<button
						onClick={() => void runEvaluate()}
						disabled={mutating}
						className="text-xs px-3 py-2 rounded border border-cyan-700/40 bg-cyan-700/20 text-cyan-200 disabled:opacity-50"
					>
						{mutating ? 'Evaluating...' : 'Re-Evaluate'}
					</button>
				</div>
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4" data-testid="blocking-reasons">
				<h2 className="text-sm font-medium text-zinc-200 mb-2">Blocking Reasons Panel</h2>
				{data.releaseState.blockingReasons.length === 0 ? (
					<p className="text-sm text-zinc-400">Aktif blocking reason yok.</p>
				) : (
					<ul className="space-y-2 text-sm text-zinc-300">
						{data.releaseState.blockingReasons.map((r, idx) => (
							<li key={`${r.code}-${idx}`} className="border border-zinc-800 rounded p-2">
								<div>code: {r.code}</div>
								<div>source: {r.source}</div>
								<div>detail: {r.detail ?? '-'}</div>
								<div>gateType: {r.gateType ?? '-'}</div>
								<div>overrideAllowed: {String(r.overrideAllowed ?? false)}</div>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2" data-testid="override-eligibility">
				<h2 className="text-sm font-medium text-zinc-200">Manual Override Eligibility Panel</h2>
				<p className="text-sm text-zinc-300">override possible: {String(canOverride)}</p>
				<p className="text-sm text-zinc-300">override forbidden: {String(!canOverride)}</p>
				<p className="text-sm text-zinc-300">who can override: release:override yetkisine sahip operator/admin</p>
				<p className="text-sm text-zinc-300">policy source: release decision policy + gate overrideAllowed</p>
				<p className="text-sm text-zinc-300">expiration constraints: gelecekteki expiresAt ve max policy window</p>
				{hardFailReasons.length > 0 ? (
					<div className="rounded border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200" data-testid="override-hard-fail">
						Hard-fail override forbidden: {hardFailReasons.map((x) => x.code).join(', ')}
					</div>
				) : null}
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3" data-testid="override-action">
				<h2 className="text-sm font-medium text-zinc-200">Manual Override Action</h2>
				<p className="text-xs text-zinc-500">One-click override yok: reason + future expiry + explicit confirm zorunlu.</p>
				<input
					placeholder="releaseCandidateId"
					value={overrideCandidateId}
					onChange={(e) => setOverrideCandidateId(e.target.value)}
					className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
				/>
				<input
					placeholder="gateEvaluationId"
					value={overrideGateEvaluationId}
					onChange={(e) => setOverrideGateEvaluationId(e.target.value)}
					className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
				/>
				<textarea
					placeholder="Override reason (mandatory)"
					value={overrideReason}
					onChange={(e) => setOverrideReason(e.target.value)}
					className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
				/>
				<input
					type="datetime-local"
					data-testid="override-expires-at"
					value={overrideExpiresAt}
					onChange={(e) => setOverrideExpiresAt(e.target.value)}
					className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
				/>
				{overrideExpiresAt && !isFuture(overrideExpiresAt) ? (
					<p className="text-xs text-red-300" data-testid="override-expiry-error">expiresAt gelecekte olmalı.</p>
				) : null}
				<label className="flex items-center gap-2 text-xs text-zinc-300">
					<input type="checkbox" checked={overrideConfirm} onChange={(e) => setOverrideConfirm(e.target.checked)} />
					Override riskini ve release etkisini anladım.
				</label>
				<button
					onClick={() => void runOverride()}
					disabled={overrideDisabled}
					className="px-3 py-2 text-xs rounded border border-amber-700/40 bg-amber-700/20 text-amber-200 disabled:opacity-50"
				>
					{mutating ? 'Applying...' : 'Apply Manual Override'}
				</button>
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2" data-testid="rollback-risk">
				<h2 className="text-sm font-medium text-zinc-200">Rollback Risk Panel</h2>
				<p className="text-sm text-zinc-300">rollbackRequired: {String(data.releaseState.rollbackRequired)}</p>
				<p className="text-sm text-zinc-300">active rollback triggers: {data.releaseState.rollbackTriggers.length}</p>
				<p className="text-sm text-zinc-300">
					critical severity trigger: {data.releaseState.rollbackTriggers.some((x) => x.severity === 'critical') ? 'yes' : 'no'}
				</p>
				<p className="text-sm text-zinc-300">
					rollback mandatory state: {data.releaseState.rollbackTriggers.some((x) => x.state === 'rollback-required') ? 'yes' : 'no'}
				</p>
				{data.releaseState.rollbackRequired ? (
					<div className="rounded border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200">
						Release proceed şu an tehlikeli: rollback önerisi güçlü.
					</div>
				) : null}
				<textarea
					placeholder="Rollback reason"
					value={rollbackReason}
					onChange={(e) => setRollbackReason(e.target.value)}
					className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
				/>
				<label className="flex items-center gap-2 text-xs text-zinc-300">
					<input type="checkbox" checked={rollbackConfirm} onChange={(e) => setRollbackConfirm(e.target.checked)} />
					Rollback işleminin release akışını etkileyeceğini anladım.
				</label>
				<button
					onClick={() => void runRollback()}
					disabled={rollbackDisabled}
					className="px-3 py-2 text-xs rounded border border-red-700/40 bg-red-700/20 text-red-200 disabled:opacity-50"
				>
					{mutating ? 'Triggering...' : 'Trigger Rollback'}
				</button>
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4" data-testid="operator-guidance">
				<h2 className="text-sm font-medium text-zinc-200 mb-2">Operator Guidance</h2>
				<ul className="space-y-1 text-sm text-zinc-300">
					{guidance.map((item) => (
						<li key={item} className="flex items-start gap-2">
							{item.toLowerCase().includes('rollback') ? <ShieldAlert size={14} className="text-red-300 mt-0.5" /> : <AlertTriangle size={14} className="text-amber-300 mt-0.5" />}
							<span>{item}</span>
						</li>
					))}
				</ul>
			</section>

			{decisionResult ? (
				<ModalOverlay onClose={() => setDecisionResult(null)}>
					<div className="w-[420px] bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2">
						<h3 className="text-zinc-100 font-medium">Son Decision Sonucu</h3>
						<p className="text-sm text-zinc-300">decision: {decisionResult.decision}</p>
						<p className="text-sm text-zinc-300">releaseCandidateId: {decisionResult.releaseCandidateId}</p>
						<button className="text-xs px-3 py-2 rounded border border-zinc-700 text-zinc-200" onClick={() => setDecisionResult(null)}>
							Kapat
						</button>
					</div>
				</ModalOverlay>
			) : null}
		</div>
	);
}
