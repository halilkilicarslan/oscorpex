import { useMemo, useState } from 'react';
import ApiErrorAlert from './ApiErrorAlert';
import ModalOverlay from '../pages/studio/ModalOverlay';
import {
	registerArtifact,
	rejectArtifact,
	supersedeArtifact,
	verifyArtifact,
	type ArtifactRecord,
	type RegisterArtifactPayload,
} from '../lib/studio-api/artifacts';

export type ArtifactActionMode = 'register' | 'verify' | 'reject' | 'supersede';

interface ArtifactActionDrawerProps {
	open: boolean;
	mode: ArtifactActionMode;
	goalId: string;
	artifact?: ArtifactRecord | null;
	initialArtifactType?: string;
	onClose: () => void;
	onSuccess: () => Promise<void> | void;
}

export default function ArtifactActionDrawer({
	open,
	mode,
	goalId,
	artifact,
	initialArtifactType,
	onClose,
	onSuccess,
}: ArtifactActionDrawerProps) {
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [artifactType, setArtifactType] = useState(initialArtifactType ?? artifact?.artifactType ?? '');
	const [title, setTitle] = useState(artifact?.title ?? '');
	const [environment, setEnvironment] = useState<'dev' | 'staging' | 'production'>(artifact?.environment ?? 'production');
	const [uri, setUri] = useState(artifact?.uri ?? '');
	const [checksum, setChecksum] = useState(artifact?.checksum ?? '');
	const [metadata, setMetadata] = useState('');
	const [note, setNote] = useState('');
	const [reason, setReason] = useState('');
	const [confirmDanger, setConfirmDanger] = useState(false);
	const [successState, setSuccessState] = useState<string | null>(null);

	const parsedMetadata = useMemo(() => {
		if (!metadata.trim()) return {};
		try {
			const parsed = JSON.parse(metadata);
			return typeof parsed === 'object' && parsed ? (parsed as Record<string, unknown>) : {};
		} catch {
			return null;
		}
	}, [metadata]);

	if (!open) return null;

	const requiresArtifactId = mode !== 'register';
	const artifactId = artifact?.id ?? '';
	const metadataInvalid = parsedMetadata === null;

	const registerDisabled =
		submitting || !goalId || !artifactType.trim() || !title.trim() || !environment || metadataInvalid;
	const verifyDisabled = submitting || !artifactId;
	const rejectDisabled = submitting || !artifactId || !reason.trim() || !confirmDanger;
	const supersedeDisabled = submitting || !artifactId || !reason.trim() || !confirmDanger;

	async function handleSubmit() {
		setSubmitting(true);
		setError(null);
		setSuccessState(null);
		try {
			if (mode === 'register') {
				const payload: RegisterArtifactPayload = {
					goalId,
					artifactType: artifactType.trim(),
					title: title.trim(),
					environment,
					uri: uri.trim() || undefined,
					checksum: checksum.trim() || undefined,
					metadata: {
						source: 'artifact-action-drawer',
						...(parsedMetadata && typeof parsedMetadata === 'object' ? parsedMetadata : {}),
					},
				};
				await registerArtifact(payload);
				setSuccessState('Artifact başarıyla kaydedildi.');
			} else if (mode === 'verify') {
				await verifyArtifact(artifactId, {
					reason: note.trim(),
					metadata: { source: 'artifact-action-drawer' },
				});
				setSuccessState('Artifact verified olarak işaretlendi.');
			} else if (mode === 'reject') {
				await rejectArtifact(artifactId, {
					reason: reason.trim(),
					metadata: { source: 'artifact-action-drawer' },
				});
				setSuccessState('Artifact rejected olarak işaretlendi.');
			} else {
				await supersedeArtifact(artifactId, {
					reason: reason.trim(),
					metadata: { source: 'artifact-action-drawer' },
				});
				setSuccessState('Artifact superseded olarak işaretlendi.');
			}
			await onSuccess();
		} catch (err) {
			setError(err as Error);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<ModalOverlay onClose={onClose}>
			<div className="w-[680px] max-w-[96vw] max-h-[90vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-4" data-testid={`artifact-drawer-${mode}`}>
				<div className="flex items-start justify-between">
					<div>
						<h3 className="text-zinc-100 text-lg font-semibold">Artifact Action Drawer</h3>
						<p className="text-xs text-zinc-400 mt-1">mode: {mode} | goal: {goalId}</p>
					</div>
					<button onClick={onClose} className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
						Close
					</button>
				</div>

				{error ? <ApiErrorAlert error={error} onRetry={() => setError(null)} /> : null}
				{successState ? <div className="rounded border border-emerald-700/40 bg-emerald-900/20 p-2 text-sm text-emerald-200">{successState}</div> : null}

				{mode === 'register' ? (
					<div className="space-y-3">
						<label className="block text-xs text-zinc-400">
							Artifact Type (required)
							<input value={artifactType} onChange={(e) => setArtifactType(e.target.value)} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
						</label>
						<label className="block text-xs text-zinc-400">
							Title (required)
							<input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
						</label>
						<label className="block text-xs text-zinc-400">
							Environment (required)
							<select value={environment} onChange={(e) => setEnvironment(e.target.value as 'dev' | 'staging' | 'production')} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100">
								<option value="dev">dev</option>
								<option value="staging">staging</option>
								<option value="production">production</option>
							</select>
						</label>
						<label className="block text-xs text-zinc-400">
							URI (optional)
							<input value={uri} onChange={(e) => setUri(e.target.value)} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
						</label>
						<label className="block text-xs text-zinc-400">
							Checksum (optional)
							<input value={checksum} onChange={(e) => setChecksum(e.target.value)} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
						</label>
						<label className="block text-xs text-zinc-400">
							Metadata JSON (optional)
							<textarea value={metadata} onChange={(e) => setMetadata(e.target.value)} rows={4} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
						</label>
						{metadataInvalid ? <p className="text-xs text-red-300">Metadata geçerli JSON olmalı.</p> : null}
					</div>
				) : null}

				{requiresArtifactId ? (
					<div className="rounded border border-zinc-800 p-3 text-sm text-zinc-300">
						<div>artifactId: {artifactId || 'n/a'}</div>
						<div>artifactType: {artifact?.artifactType ?? 'n/a'}</div>
						<div>title: {artifact?.title ?? 'n/a'}</div>
						<div>status: {artifact?.status ?? 'n/a'}</div>
					</div>
				) : null}

				{mode === 'verify' ? (
					<label className="block text-xs text-zinc-400">
						Verify note (optional)
						<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
					</label>
				) : null}

				{mode === 'reject' || mode === 'supersede' ? (
					<div className="space-y-3">
						<label className="block text-xs text-zinc-400">
							Reason (required)
							<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100" />
						</label>
						{mode === 'supersede' ? (
							<p className="text-xs text-amber-300">
								Supersede sonrası eski artifact inactive olur ve latest projection değişir.
							</p>
						) : null}
						<label className="flex items-center gap-2 text-xs text-zinc-300">
							<input type="checkbox" checked={confirmDanger} onChange={(e) => setConfirmDanger(e.target.checked)} />
							Bu işlemin destrüktif etkisini anladım.
						</label>
					</div>
				) : null}

				<div className="flex gap-2">
					<button onClick={handleSubmit} disabled={(mode === 'register' && registerDisabled) || (mode === 'verify' && verifyDisabled) || (mode === 'reject' && rejectDisabled) || (mode === 'supersede' && supersedeDisabled)} className="px-3 py-2 text-xs rounded border border-cyan-700/40 bg-cyan-700/20 text-cyan-200 disabled:opacity-50">
						{submitting ? 'Submitting...' : `Apply ${mode}`}
					</button>
					<button onClick={onClose} className="px-3 py-2 text-xs rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
						Cancel
					</button>
				</div>
			</div>
		</ModalOverlay>
	);
}
