// ---------------------------------------------------------------------------
// Webhook Section
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Globe, Plus } from 'lucide-react';
import { fetchWebhooks, type Webhook } from '../../../lib/studio-api';
import WebhookRow from './WebhookRow.js';
import WebhookModal from './WebhookModal.js';

interface WebhookSectionProps {
	projectId: string;
}

export default function WebhookSection({ projectId }: WebhookSectionProps) {
	const [webhooks, setWebhooks] = useState<Webhook[]>([]);
	const [loading, setLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [editTarget, setEditTarget] = useState<Webhook | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await fetchWebhooks(projectId);
			setWebhooks(data);
		} catch { /* silent */ }
		finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => { load(); }, [load]);

	const handleSaved = (wh: Webhook) => {
		setShowModal(false);
		setEditTarget(null);
		setWebhooks((prev) => {
			const idx = prev.findIndex((w) => w.id === wh.id);
			return idx >= 0 ? prev.map((w) => (w.id === wh.id ? wh : w)) : [wh, ...prev];
		});
	};

	const handleEdit = (wh: Webhook) => {
		setEditTarget(wh);
		setShowModal(true);
	};

	const handleAdd = () => {
		setEditTarget(null);
		setShowModal(true);
	};

	return (
		<div className="bg-[#111111] border border-[#262626] rounded-xl overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<Globe size={14} className="text-[#22c55e]" />
				<h3 className="text-[12px] font-semibold text-[#fafafa]">Webhooks</h3>
				<span className="ml-auto flex items-center gap-2">
					<button
						onClick={handleAdd}
						className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
					>
						<Plus size={10} />
						Webhook Ekle
					</button>
				</span>
			</div>
			<div className="px-4 py-2">
				<p className="text-[10px] text-[#525252]">
					Slack, Discord veya herhangi bir sisteme event bildirimleri gonderin.
					Gorev tamamlanma, pipeline bitis ve hata durumlarini anlik takip edin.
				</p>
			</div>
			<div className="px-4 pb-4 space-y-2">
				{loading ? (
					<div className="flex justify-center py-4">
						<Loader2 size={14} className="animate-spin text-[#525252]" />
					</div>
				) : webhooks.length === 0 ? (
					<div className="text-center py-6 text-[10px] text-[#525252]">
						Henuz webhook eklenmedi. &quot;Webhook Ekle&quot; butonuna tiklayin.
					</div>
				) : (
					webhooks.map((wh) => (
						<WebhookRow
							key={wh.id}
							webhook={wh}
							projectId={projectId}
							onEdit={() => handleEdit(wh)}
							onDeleted={load}
						/>
					))
				)}
			</div>
			{showModal && (
				<WebhookModal
					projectId={projectId}
					initial={editTarget ?? undefined}
					onClose={() => { setShowModal(false); setEditTarget(null); }}
					onSaved={handleSaved}
				/>
			)}
		</div>
	);
}
