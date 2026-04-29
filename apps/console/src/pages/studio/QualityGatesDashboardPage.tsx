import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import ApiErrorAlert from '../../components/ApiErrorAlert';
import {
	getApprovalState,
	getArtifactCompleteness,
	getQualityGateBlockers,
	getQualityGateEvaluations,
	getQualityGateReadiness,
	getReleaseState,
	type ApprovalState,
	type ArtifactCompleteness,
	type BlockingGate,
	type QualityGateEvaluation,
	type QualityGateReadiness,
	type ReleaseState,
} from '../../lib/studio-api/quality-gates';
import { StudioApiError } from '../../lib/studio-api/base';

interface DashboardData {
	readiness: QualityGateReadiness;
	evaluations: QualityGateEvaluation[];
	blockers: BlockingGate[];
	approvalState: ApprovalState;
	releaseState: ReleaseState;
	artifactCompleteness: ArtifactCompleteness;
}

function badgeClass(state: string): string {
	switch (state) {
		case 'passed':
			return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
		case 'failed':
		case 'blocked':
			return 'bg-red-500/10 text-red-300 border-red-500/30';
		case 'warning':
			return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
		case 'missing':
			return 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30';
		case 'overridden':
			return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
		default:
			return 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30';
	}
}

export default function QualityGatesDashboardPage() {
	const { goalId } = useParams<{ goalId: string }>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const [data, setData] = useState<DashboardData | null>(null);

	const load = useCallback(async () => {
		if (!goalId) return;
		setLoading(true);
		setError(null);
		try {
			const [readiness, evaluations, blockers, approvalState, releaseState, artifactCompleteness] =
				await Promise.all([
					getQualityGateReadiness(goalId),
					getQualityGateEvaluations(goalId),
					getQualityGateBlockers(goalId),
					getApprovalState(goalId),
					getReleaseState(goalId),
					getArtifactCompleteness(goalId),
				]);
			setData({ readiness, evaluations, blockers, approvalState, releaseState, artifactCompleteness });
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

	const guidance = useMemo(() => {
		if (!data) return [] as string[];
		const items: string[] = [];
		if (data.releaseState.rollbackRequired) {
			items.push('Rollback required: önce rollback trigger nedenini doğrula ve release akışını durdur.');
		}
		if (!data.approvalState.satisfied) {
			items.push('Approve pending request: bekleyen onayları tamamla.');
		}
		if (!data.artifactCompleteness.satisfied) {
			items.push('Upload/register missing artifact: eksik artifact türlerini tamamla.');
		}
		if (data.releaseState.blockingReasons.some((r) => r.code === 'blocking_gate')) {
			items.push('Fix failed quality gate: başarısız gate değerlendirmelerini düzelt ve yeniden değerlendir.');
		}
		if (data.releaseState.requiresOverride) {
			const hasOverridable = data.releaseState.blockingReasons.some((r) => r.overrideAllowed);
			items.push(
				hasOverridable
					? 'Manual override possible: yetkili rol ile zaman sınırlı override değerlendirilebilir.'
					: 'Manual override forbidden: hard-fail gate nedeniyle override uygulanamaz.',
			);
		}
		if (items.length === 0 && data.releaseState.allowed) {
			items.push('Release ready: release adayını güvenle ilerletebilirsin.');
		}
		return items;
	}, [data]);

	if (!goalId) {
		return <div className="p-6 text-sm text-zinc-300">Geçersiz hedef: goalId bulunamadı.</div>;
	}

	if (loading) {
		return (
			<div className="p-6 flex items-center gap-3 text-zinc-300" data-testid="qg-loading">
				<Loader2 className="animate-spin" size={18} />
				Dashboard yükleniyor...
			</div>
		);
	}

	if (error) {
		const apiError = error instanceof StudioApiError ? error : null;
		if (apiError?.status === 403) {
			return (
				<div className="p-6 space-y-4" data-testid="qg-error-403">
					<ApiErrorAlert error={error} onRetry={() => void load()} />
					<p className="text-sm text-zinc-400">Bu goal için Quality Gates dashboard erişim iznin yok.</p>
				</div>
			);
		}
		if (apiError?.status === 404) {
			return (
				<div className="p-6 space-y-4" data-testid="qg-error-404">
					<ApiErrorAlert error={error} onRetry={() => void load()} />
					<p className="text-sm text-zinc-400">Goal bulunamadı veya henüz değerlendirme üretilmedi.</p>
				</div>
			);
		}
		return (
			<div className="p-6" data-testid="qg-error-generic">
				<ApiErrorAlert error={error} onRetry={() => void load()} />
			</div>
		);
	}

	if (!data) {
		return (
			<div className="p-6 text-sm text-zinc-400" data-testid="qg-empty">
				Henüz kalite kapısı verisi bulunamadı.
			</div>
		);
	}

	const blockingCount = data.releaseState.blockingReasons.length;
	const missingApprovalCount = data.approvalState.missingApprovals;
	const missingArtifactCount = data.artifactCompleteness.missingArtifacts.length;
	const latestDecision = data.releaseState.latestDecision?.decision ?? 'no-decision';
	const releaseLabel = data.releaseState.rollbackRequired
		? 'Rollback Required'
		: data.releaseState.allowed
			? 'Allowed'
			: 'Blocked';

	return (
		<div className="p-6 space-y-6" data-testid="qg-dashboard">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold text-zinc-100">Quality Gates Dashboard</h1>
					<p className="text-sm text-zinc-400 mt-1">Goal: {goalId}</p>
				</div>
				<div className="flex items-center gap-2">
					<Link className="text-xs px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800" to="/studio/control-plane">
						Control Plane
					</Link>
					<button onClick={() => void load()} className="text-xs px-3 py-2 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700">
						Refresh
					</button>
				</div>
			</div>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3" data-testid="release-summary">
				<h2 className="text-sm font-medium text-zinc-200">Release Status Summary</h2>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
					<div><span className="text-zinc-500">Status</span><p className="text-zinc-100">{releaseLabel}</p></div>
					<div><span className="text-zinc-500">Environment</span><p className="text-zinc-100">{data.readiness.environment}</p></div>
					<div><span className="text-zinc-500">Rollback Required</span><p className="text-zinc-100">{String(data.releaseState.rollbackRequired)}</p></div>
					<div><span className="text-zinc-500">Last Decision</span><p className="text-zinc-100">{latestDecision}</p></div>
					<div><span className="text-zinc-500">Blocking Reasons</span><p className="text-zinc-100">{blockingCount}</p></div>
					<div><span className="text-zinc-500">Missing Approvals</span><p className="text-zinc-100">{missingApprovalCount}</p></div>
					<div><span className="text-zinc-500">Missing Artifacts</span><p className="text-zinc-100">{missingArtifactCount}</p></div>
				</div>
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4" data-testid="gate-table">
				<h2 className="text-sm font-medium text-zinc-200 mb-3">Gate Status Table</h2>
				<div className="overflow-x-auto">
					<table className="min-w-full text-xs text-zinc-300">
						<thead className="text-zinc-500 border-b border-zinc-800">
							<tr>
								<th className="text-left py-2 pr-3">Gate Type</th>
								<th className="text-left py-2 pr-3">Status</th>
								<th className="text-left py-2 pr-3">Required</th>
								<th className="text-left py-2 pr-3">Blocking</th>
								<th className="text-left py-2 pr-3">Latest Evaluation</th>
								<th className="text-left py-2 pr-3">Reason</th>
								<th className="text-left py-2">Override Allowed</th>
							</tr>
						</thead>
						<tbody>
							{data.readiness.requiredGates.map((gate) => {
								const evalRow = data.evaluations.find((e) => e.gateType === gate.gateType);
								const blocker = data.blockers.find((b) => b.gateType === gate.gateType);
								const missing = data.readiness.missingEvaluations.some((m) => m.gate?.gateType === gate.gateType);
								const status = missing ? 'missing' : evalRow?.outcome ?? (blocker ? 'blocked' : 'passed');
								return (
									<tr key={gate.id} className="border-b border-zinc-900">
										<td className="py-2 pr-3">{gate.gateType}</td>
										<td className="py-2 pr-3">
											<span className={`px-2 py-0.5 rounded border ${badgeClass(status)}`}>{status}</span>
										</td>
										<td className="py-2 pr-3">{String(gate.required)}</td>
										<td className="py-2 pr-3">{String(gate.blocking)}</td>
										<td className="py-2 pr-3">{evalRow?.outcome ?? 'n/a'}</td>
										<td className="py-2 pr-3">{evalRow?.reason || blocker?.reason || '-'}</td>
										<td className="py-2">{String(gate.overrideAllowed)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2" data-testid="approval-summary">
					<h2 className="text-sm font-medium text-zinc-200">Approval Summary</h2>
					<p className="text-xs text-zinc-400">satisfied: {String(data.approvalState.satisfied)}</p>
					<p className="text-xs text-zinc-400">blocked: {String(data.approvalState.blocked)}</p>
					<p className="text-xs text-zinc-400">expired: {data.approvalState.expired.length}</p>
					<p className="text-xs text-zinc-400">rejected: {data.approvalState.rejected.length}</p>
					<p className="text-xs text-zinc-400">missing approvals: {data.approvalState.missingApprovals}</p>
					<p className="text-xs text-zinc-400">
						approved actors: {data.approvalState.states.flatMap((x) => x.approvedActorIds).join(', ') || 'none'}
					</p>
					<p className="text-xs text-zinc-400">
						rejected actors: {data.approvalState.states.flatMap((x) => x.rejectedActorIds).join(', ') || 'none'}
					</p>
					<p className="text-xs text-zinc-400">pending approvals: {data.approvalState.pending.length}</p>
				</section>

				<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2" data-testid="artifact-summary">
					<h2 className="text-sm font-medium text-zinc-200">Artifact Completeness Summary</h2>
					<p className="text-xs text-zinc-400">satisfied: {String(data.artifactCompleteness.satisfied)}</p>
					<p className="text-xs text-zinc-400">missing artifacts: {data.artifactCompleteness.missingArtifacts.join(', ') || 'none'}</p>
					<p className="text-xs text-zinc-400">stale artifacts: {data.artifactCompleteness.staleArtifacts.length}</p>
					<p className="text-xs text-zinc-400">rejected artifacts: {data.artifactCompleteness.rejectedArtifacts.length}</p>
					<p className="text-xs text-zinc-400">latest artifacts: {data.artifactCompleteness.latestArtifacts.length}</p>
					<p className="text-xs text-zinc-400">required artifacts: {data.artifactCompleteness.requiredArtifacts.join(', ')}</p>
				</section>
			</div>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2" data-testid="rollback-panel">
				<h2 className="text-sm font-medium text-zinc-200">Rollback / Risk Panel</h2>
				<p className="text-xs text-zinc-400">rollbackRequired: {String(data.releaseState.rollbackRequired)}</p>
				<p className="text-xs text-zinc-400">active rollback triggers: {data.releaseState.rollbackTriggers.length}</p>
				<p className="text-xs text-zinc-400">
					critical trigger reason:{' '}
					{data.releaseState.rollbackTriggers.find((t) => t.severity === 'critical')?.reason ?? 'none'}
				</p>
				<p className="text-xs text-zinc-400">
					release.rollback_required state: {String(data.releaseState.rollbackTriggers.some((t) => t.state === 'rollback-required'))}
				</p>
			</section>

			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2" data-testid="operator-guidance">
				<h2 className="text-sm font-medium text-zinc-200">Operator Guidance</h2>
				{guidance.map((item) => (
					<div key={item} className="flex items-start gap-2 text-sm text-zinc-300">
						{item.toLowerCase().includes('rollback') ? <ShieldAlert size={16} className="text-red-300 mt-0.5" /> : null}
						{item.toLowerCase().includes('ready') ? <CheckCircle2 size={16} className="text-emerald-300 mt-0.5" /> : null}
						{!item.toLowerCase().includes('rollback') && !item.toLowerCase().includes('ready') ? (
							<AlertTriangle size={16} className="text-amber-300 mt-0.5" />
						) : null}
						<span>{item}</span>
					</div>
				))}
				<div className="pt-2 flex gap-2">
					<Link to="/studio/control-plane" className="text-xs px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
						Open Approvals
					</Link>
					<Link to="/studio" className="text-xs px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
						Open Projects
					</Link>
				</div>
			</section>
		</div>
	);
}
