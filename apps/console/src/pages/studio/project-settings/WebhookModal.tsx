// ---------------------------------------------------------------------------
// Webhook Modal
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Loader2, Save, AlertCircle } from 'lucide-react';
import { createWebhook, updateWebhook, type Webhook, type WebhookType, type WebhookEventType } from '../../../lib/studio-api';
import { WEBHOOK_EVENTS } from './helpers.js';

interface WebhookModalProps {
	projectId: string;
	initial?: Partial<Webhook>;
	onClose: () => void;
	onSaved: (webhook: Webhook) => void;
}

export default function WebhookModal({ projectId, initial, onClose, onSaved }: WebhookModalProps) {
	const [name, setName] = useState(initial?.name ?? '');
	const [url, setUrl] = useState(initial?.url ?? '');
	const [type, setType] = useState<WebhookType>(initial?.type ?? 'generic');
	const [events, setEvents] = useState<WebhookEventType[]>(initial?.events ?? []);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const toggleEvent = (ev: WebhookEventType) => {
		setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
	};

	const handleSave = async () => {
		setErr(null);
		if (!url.startsWith('https://') && !url.startsWith('http://')) {
			setErr('URL https:// ile baslamamali');
			return;
		}
		if (!name.trim()) {
			setErr('Webhook adi zorunludur');
			return;
		}
		setSaving(true);
		try {
			let saved: Webhook;
			if (initial?.id) {
				saved = await updateWebhook(projectId, initial.id, { name, url, type, events });
			} else {
				saved = await createWebhook(projectId, { name, url, type, events });
			}
			onSaved(saved);
		} catch (e) {
			setErr(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div className="w-full max-w-md bg-[#111111] border border-[#262626] rounded-xl p-5 space-y-4 shadow-2xl">
				<div className="flex items-center justify-between">
					<h3 className="text-[13px] font-semibold text-[#fafafa]">
						{initial?.id ? 'Webhook Duzenle' : 'Webhook Ekle'}
					</h3>
					<button onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3] text-lg leading-none">
						×
					</button>
				</div>

				{err && (
					<div className="flex items-center gap-2 px-3 py-2 bg-[#450a0a]/40 border border-[#7f1d1d] rounded-lg text-[11px] text-[#f87171]">
						<AlertCircle size={11} />
						{err}
					</div>
				)}

				<div className="space-y-1.5">
					<label className="text-[11px] text-[#a3a3a3]">Ad</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Deploy bildirimleri"
						className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-1.5 text-[12px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040]"
					/>
				</div>

				<div className="space-y-1.5">
					<label className="text-[11px] text-[#a3a3a3]">Webhook URL</label>
					<input
						type="url"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://hooks.slack.com/services/..."
						className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-1.5 text-[12px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040]"
					/>
				</div>

				<div className="space-y-1.5">
					<label className="text-[11px] text-[#a3a3a3]">Tur</label>
					<select
						value={type}
						onChange={(e) => setType(e.target.value as WebhookType)}
						className="w-full bg-[#0a0a0a] border border-[#262626] rounded-md px-3 py-1.5 text-[12px] text-[#fafafa] focus:outline-none focus:border-[#404040]"
					>
						<option value="slack">Slack</option>
						<option value="discord">Discord</option>
						<option value="generic">Generic (JSON)</option>
					</select>
				</div>

				<div className="space-y-1.5">
					<label className="text-[11px] text-[#a3a3a3]">Dinlenecek Event'ler</label>
					<div className="grid grid-cols-2 gap-1.5">
						{WEBHOOK_EVENTS.map(({ value, label }) => (
							<label key={value} className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={events.includes(value)}
									onChange={() => toggleEvent(value)}
									className="w-3.5 h-3.5 accent-[#22c55e]"
								/>
								<span className="text-[11px] text-[#a3a3a3]">{label}</span>
							</label>
						))}
					</div>
				</div>

				<div className="flex justify-end gap-2 pt-2">
					<button onClick={onClose} className="px-3 py-1.5 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors">
						Iptal
					</button>
					<button
						onClick={handleSave}
						disabled={saving}
						className="flex items-center gap-1.5 px-3 py-1.5 bg-[#22c55e] hover:bg-[#16a34a] text-black text-[11px] font-medium rounded-md transition-colors disabled:opacity-50"
					>
						{saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
						Save
					</button>
				</div>
			</div>
		</div>
	);
}
