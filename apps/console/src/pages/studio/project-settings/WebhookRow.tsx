// ---------------------------------------------------------------------------
// Webhook Row
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Loader2, Zap, Save, Trash2 } from 'lucide-react';
import { testWebhook, updateWebhook, deleteWebhook, type Webhook } from '../../../lib/studio-api';
import { WEBHOOK_TYPE_LABELS } from './helpers.js';

interface WebhookRowProps {
	webhook: Webhook;
	projectId: string;
	onEdit: () => void;
	onDeleted: () => void;
}

export default function WebhookRow({ webhook, projectId, onEdit, onDeleted }: WebhookRowProps) {
	const [testing, setTesting] = useState(false);
	const [testMsg, setTestMsg] = useState<string | null>(null);
	const [toggling, setToggling] = useState(false);

	const handleTest = async () => {
		setTesting(true);
		setTestMsg(null);
		try {
			const res = await testWebhook(projectId, webhook.id);
			setTestMsg(res.success ? 'Test sent!' : 'Test failed');
			setTimeout(() => setTestMsg(null), 3000);
		} catch {
			setTestMsg('Test hatasi');
			setTimeout(() => setTestMsg(null), 3000);
		} finally {
			setTesting(false);
		}
	};

	const handleToggle = async () => {
		setToggling(true);
		try {
			await updateWebhook(projectId, webhook.id, { active: !webhook.active });
			onDeleted();
		} catch { /* silent */ }
		finally {
			setToggling(false);
		}
	};

	const handleDelete = async () => {
		if (!confirm(`"${webhook.name}" webhook'u silinsin mi?`)) return;
		try {
			await deleteWebhook(projectId, webhook.id);
			onDeleted();
		} catch { /* silent */ }
	};

	const typeInfo = WEBHOOK_TYPE_LABELS[webhook.type];

	return (
		<div className="flex items-center gap-3 px-3 py-2.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg hover:border-[#262626] transition-colors">
			<span
				className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
				style={{ color: typeInfo.color, backgroundColor: typeInfo.color + '22' }}
			>
				{typeInfo.label}
			</span>
			<div className="flex-1 min-w-0">
				<p className="text-[12px] font-medium text-[#fafafa] truncate">{webhook.name}</p>
				<p className="text-[10px] text-[#525252] truncate">{webhook.url}</p>
			</div>
			<span className="text-[10px] text-[#525252] shrink-0">{webhook.events.length} event</span>
			{testMsg && <span className="text-[10px] text-[#22c55e] shrink-0">{testMsg}</span>}
			{toggling ? (
				<Loader2 size={12} className="animate-spin text-[#525252]" />
			) : (
				<button
					onClick={handleToggle}
					title={webhook.active ? 'Pasif yap' : 'Aktif yap'}
					className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
						webhook.active ? 'bg-[#22c55e]' : 'bg-[#333333]'
					}`}
				>
					<span
						className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
							webhook.active ? 'translate-x-[13px]' : 'translate-x-[2px]'
						}`}
					/>
				</button>
			)}
			<button
				onClick={handleTest}
				disabled={testing}
				title="Test bildirimi gonder"
				className="text-[#525252] hover:text-[#60a5fa] transition-colors disabled:opacity-50"
			>
				{testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
			</button>
			<button onClick={onEdit} title="Duzenle" className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
				<Save size={12} />
			</button>
			<button onClick={handleDelete} title="Sil" className="text-[#525252] hover:text-[#f87171] transition-colors">
				<Trash2 size={12} />
			</button>
		</div>
	);
}
