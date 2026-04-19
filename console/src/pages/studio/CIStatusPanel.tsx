// ---------------------------------------------------------------------------
// Oscorpex — CIStatusPanel (V6 M3)
// Displays GitHub / GitLab CI tracking status for a project.
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { fetchCIStatus, trackPR, type CITracking, type CIProvider } from '../../lib/studio-api/ci.js';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProviderIcon({ provider }: { provider: CIProvider }) {
	if (provider === 'github') {
		return (
			<svg
				aria-label="GitHub"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="currentColor"
				className="text-[#e6edf3] inline-block"
			>
				<path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.604-.015 2.896-.015 3.286 0 .322.216.694.825.577C20.565 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
			</svg>
		);
	}
	return (
		<svg
			aria-label="GitLab"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="currentColor"
			className="text-[#fc6d26] inline-block"
		>
			<path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 0 0-.867 0L16.418 9.45H7.582L4.918 1.263a.455.455 0 0 0-.867 0L1.387 9.452.045 13.587a.924.924 0 0 0 .331 1.023L12 23.054l11.624-8.443a.924.924 0 0 0 .331-1.024z" />
		</svg>
	);
}

function StatusBadge({ status }: { status: CITracking['status'] }) {
	const map: Record<string, { label: string; className: string }> = {
		pending: { label: 'Pending', className: 'bg-[#451a03] text-[#f59e0b] border border-[#78350f]' },
		running: { label: 'Running', className: 'bg-[#1e3a5f] text-[#60a5fa] border border-[#1d4ed8]' },
		success: { label: 'Success', className: 'bg-[#052e16] text-[#22c55e] border border-[#166534]' },
		failure: { label: 'Failure', className: 'bg-[#450a0a] text-[#ef4444] border border-[#991b1b]' },
		cancelled: { label: 'Cancelled', className: 'bg-[#1c1c1c] text-[#9ca3af] border border-[#374151]' },
	};
	const { label, className } = map[status] ?? map.pending;
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
			{label}
		</span>
	);
}

// ---------------------------------------------------------------------------
// TrackPRModal
// ---------------------------------------------------------------------------

function TrackPRModal({
	projectId,
	onClose,
	onTracked,
}: {
	projectId: string;
	onClose: () => void;
	onTracked: () => void;
}) {
	const [provider, setProvider] = useState<CIProvider>('github');
	const [prId, setPrId] = useState('');
	const [prUrl, setPrUrl] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!prId.trim()) return;
		setSubmitting(true);
		setError(null);
		try {
			await trackPR({ projectId, provider, prId: prId.trim(), prUrl: prUrl.trim() || undefined });
			onTracked();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to track PR');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div className="bg-[#111111] border border-[#262626] rounded-lg p-6 w-full max-w-md shadow-xl">
				<h2 className="text-white font-semibold text-lg mb-4">Track Pull Request</h2>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-sm text-[#9ca3af] mb-1">Provider</label>
						<select
							value={provider}
							onChange={(e) => setProvider(e.target.value as CIProvider)}
							className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#22c55e]"
						>
							<option value="github">GitHub</option>
							<option value="gitlab">GitLab</option>
						</select>
					</div>
					<div>
						<label className="block text-sm text-[#9ca3af] mb-1">PR / MR Number</label>
						<input
							type="text"
							value={prId}
							onChange={(e) => setPrId(e.target.value)}
							placeholder="e.g. 42"
							className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#22c55e]"
						/>
					</div>
					<div>
						<label className="block text-sm text-[#9ca3af] mb-1">PR URL (optional)</label>
						<input
							type="url"
							value={prUrl}
							onChange={(e) => setPrUrl(e.target.value)}
							placeholder="https://github.com/owner/repo/pull/42"
							className="w-full bg-[#0a0a0a] border border-[#262626] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#22c55e]"
						/>
					</div>
					{error && <p className="text-[#ef4444] text-sm">{error}</p>}
					<div className="flex gap-2 justify-end pt-2">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 text-sm text-[#9ca3af] hover:text-white transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={submitting || !prId.trim()}
							className="px-4 py-2 text-sm bg-[#22c55e] text-black rounded hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{submitting ? 'Tracking...' : 'Track PR'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// CIStatusPanel
// ---------------------------------------------------------------------------

interface CIStatusPanelProps {
	projectId: string;
}

export default function CIStatusPanel({ projectId }: CIStatusPanelProps) {
	const [trackings, setTrackings] = useState<CITracking[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showModal, setShowModal] = useState(false);

	const load = useCallback(async () => {
		try {
			const data = await fetchCIStatus(projectId);
			setTrackings(data);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load CI status');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		load();
		const interval = setInterval(load, 30_000);
		return () => clearInterval(interval);
	}, [load]);

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-lg p-4">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-white font-semibold text-sm">CI / CD Status</h3>
				<button
					onClick={() => setShowModal(true)}
					className="px-3 py-1.5 text-xs bg-[#22c55e] text-black rounded hover:bg-[#16a34a] transition-colors font-medium"
				>
					+ Track PR
				</button>
			</div>

			{/* Content */}
			{loading ? (
				<div className="text-[#9ca3af] text-sm text-center py-6">Loading...</div>
			) : error ? (
				<div className="text-[#ef4444] text-sm text-center py-6">{error}</div>
			) : trackings.length === 0 ? (
				<div className="text-[#9ca3af] text-sm text-center py-8">
					No CI trackings yet. Click &quot;Track PR&quot; to start monitoring a pull request.
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-[#262626]">
								<th className="text-left text-[#9ca3af] font-medium py-2 pr-4">Provider</th>
								<th className="text-left text-[#9ca3af] font-medium py-2 pr-4">PR / MR</th>
								<th className="text-left text-[#9ca3af] font-medium py-2 pr-4">Status</th>
								<th className="text-left text-[#9ca3af] font-medium py-2 pr-4">Pipeline</th>
								<th className="text-left text-[#9ca3af] font-medium py-2">Updated</th>
							</tr>
						</thead>
						<tbody>
							{trackings.map((t) => (
								<tr key={t.id} className="border-b border-[#1a1a1a] hover:bg-[#0a0a0a] transition-colors">
									{/* Provider */}
									<td className="py-3 pr-4">
										<div className="flex items-center gap-1.5">
											<ProviderIcon provider={t.provider} />
											<span className="text-[#e6edf3] capitalize">{t.provider}</span>
										</div>
									</td>

									{/* PR link */}
									<td className="py-3 pr-4">
										{t.prUrl ? (
											<a
												href={t.prUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="text-[#60a5fa] hover:underline"
											>
												#{t.prId}
											</a>
										) : (
											<span className="text-[#e6edf3]">#{t.prId}</span>
										)}
									</td>

									{/* Status badge */}
									<td className="py-3 pr-4">
										<StatusBadge status={t.status} />
									</td>

									{/* Pipeline link */}
									<td className="py-3 pr-4">
										{t.pipelineUrl ? (
											<a
												href={t.pipelineUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="text-[#60a5fa] hover:underline text-xs"
											>
												View pipeline
											</a>
										) : (
											<span className="text-[#4b5563] text-xs">—</span>
										)}
									</td>

									{/* Updated at */}
									<td className="py-3 text-[#9ca3af] text-xs">{formatDate(t.updatedAt)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Track PR modal */}
			{showModal && (
				<TrackPRModal
					projectId={projectId}
					onClose={() => setShowModal(false)}
					onTracked={load}
				/>
			)}
		</div>
	);
}
