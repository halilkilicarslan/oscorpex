import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchTaskInspector, type TaskSessionInspector } from '../../lib/studio-api/inspector';
import { InspectorHeader } from '../../components/inspector/InspectorHeader';
import { InspectorTimeline } from '../../components/inspector/InspectorTimeline';
import { InspectorUsageCards } from '../../components/inspector/InspectorUsageCards';
import { InspectorObservations } from '../../components/inspector/InspectorObservations';
import { InspectorOutputPanel } from '../../components/inspector/InspectorOutputPanel';
import { InspectorGateSummary } from '../../components/inspector/InspectorGateSummary';
import { InspectorRawDebug } from '../../components/inspector/InspectorRawDebug';

type PageState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'not_found' }
	| { status: 'ok'; data: TaskSessionInspector };

export function TaskSessionInspectorPage() {
	const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
	const validParams = !!(projectId && taskId);
	const [state, setState] = useState<PageState>(
		validParams ? { status: 'loading' } : { status: 'not_found' },
	);

	useEffect(() => {
		if (!projectId || !taskId) return;
		let cancelled = false;
		fetchTaskInspector(projectId, taskId)
			.then((data) => {
				if (!cancelled) setState({ status: 'ok', data });
			})
			.catch((err) => {
				if (cancelled) return;
				if (err?.status === 404) {
					setState({ status: 'not_found' });
				} else {
					setState({ status: 'error', message: err?.message ?? 'Failed to load inspector' });
				}
			});
		return () => { cancelled = true; };
	}, [projectId, taskId]);

	if (state.status === 'loading') {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-[#262626] border-t-[#22c55e]" />
			</div>
		);
	}

	if (state.status === 'not_found') {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-2 text-[#737373]">
				<span className="text-lg">Task not found</span>
				<Link to={`/studio/${projectId}`} className="text-sm text-[#22c55e] hover:underline">
					Back to project
				</Link>
			</div>
		);
	}

	if (state.status === 'error') {
		return (
			<div className="flex h-64 flex-col items-center justify-center gap-2">
				<span className="text-red-400">{state.message}</span>
				<button
					type="button"
					className="text-sm text-[#22c55e] hover:underline"
					onClick={() => window.location.reload()}
				>
					Retry
				</button>
			</div>
		);
	}

	const { data } = state;

	return (
		<div className="mx-auto max-w-5xl space-y-4 p-4">
			{/* Breadcrumb */}
			<div className="flex items-center gap-1 text-xs text-[#525252]">
				<Link to={`/studio/${data.projectId}`} className="hover:text-white">
					Project
				</Link>
				<span>/</span>
				<span className="text-[#a3a3a3]">Inspector</span>
			</div>

			{/* Warnings */}
			{data.warnings.length > 0 && (
				<div className="space-y-1">
					{data.warnings.map((w) => (
						<div
							key={w.code}
							className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-400"
						>
							{w.message}
						</div>
					))}
				</div>
			)}

			<InspectorHeader task={data.task} agent={data.agent} session={data.session} />

			{/* Strategy */}
			{data.strategy?.name && (
				<div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
					<h3 className="mb-2 text-sm font-semibold text-white">Strategy</h3>
					<div className="text-sm text-[#e5e5e5]">{data.strategy.name}</div>
					{data.strategy.confidence != null && (
						<div className="mt-1 text-xs text-[#737373]">
							Confidence: {(data.strategy.confidence * 100).toFixed(0)}%
						</div>
					)}
					{data.strategy.reason && (
						<div className="mt-1 text-xs text-[#525252]">{data.strategy.reason}</div>
					)}
				</div>
			)}

			<InspectorUsageCards usage={data.usage} execution={data.execution} />
			<InspectorTimeline items={data.timeline} />
			<InspectorObservations observations={data.observations} />
			<InspectorOutputPanel output={data.output} />
			<InspectorGateSummary gates={data.gates} />
			<InspectorRawDebug raw={data.raw} />
		</div>
	);
}

export default TaskSessionInspectorPage;
