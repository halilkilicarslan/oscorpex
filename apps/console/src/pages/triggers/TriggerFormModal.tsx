import { useState } from 'react';
import { Workflow, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { httpPost, httpPut } from '../../lib/studio-api/base.js';
import {
	type Trigger,
	type TriggerFormValues,
	type TriggerType,
	type ActionType,
	API_BASE,
	TYPE_META,
	ACTION_LABELS,
	EVENT_TYPES,
	EMPTY_FORM,
	triggerToForm,
	formToPayload,
	cronHuman,
} from './types.js';

interface TriggerFormModalProps {
	editing: Trigger | null;
	onClose: () => void;
	onSaved: () => void;
}

export function TriggerFormModal({ editing, onClose, onSaved }: TriggerFormModalProps) {
	const [form, setForm] = useState<TriggerFormValues>(editing ? triggerToForm(editing) : EMPTY_FORM);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function setField<K extends keyof TriggerFormValues>(key: K, val: TriggerFormValues[K]) {
		setForm((f) => ({ ...f, [key]: val }));
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!form.name.trim()) { setError('Trigger name is required.'); return; }
		setLoading(true);
		setError(null);
		try {
			const url = editing ? `${API_BASE}/triggers/${editing.id}` : `${API_BASE}/triggers`;
			try {
				if (editing) {
					await httpPut(url, formToPayload(form));
				} else {
					await httpPost(url, formToPayload(form));
				}
			} catch (err: any) {
				setError(err?.message ?? 'Operation failed.');
				return;
			}
			onSaved();
			onClose();
		} catch {
			setError('Could not reach server.');
		} finally {
			setLoading(false);
		}
	}

	const inputCls = 'w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] placeholder-[#525252] focus:outline-none focus:border-[#22c55e]';
	const selectCls = 'w-full px-2.5 py-1.5 text-xs bg-[#0a0a0a] border border-[#262626] rounded-md text-[#fafafa] focus:outline-none focus:border-[#22c55e]';
	const labelCls = 'block text-[11px] text-[#525252] mb-1';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div className="w-full max-w-xl bg-[#111111] border border-[#262626] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-[#262626]">
					<div className="flex items-center gap-2">
						<Workflow className="w-4 h-4 text-[#22c55e]" />
						<span className="text-sm font-semibold text-[#fafafa]">
							{editing ? 'Edit Trigger' : 'Create Trigger'}
						</span>
					</div>
					<button onClick={onClose} className="text-[#525252] hover:text-[#a3a3a3] transition-colors">
						<X className="w-4 h-4" />
					</button>
				</div>

				<form onSubmit={(e) => { void submit(e); }} className="flex-1 overflow-y-auto p-5 space-y-4">
					{/* Name + Description */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className={labelCls}>Name *</label>
							<input type="text" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="My Trigger" className={inputCls} />
						</div>
						<div>
							<label className={labelCls}>Description</label>
							<input type="text" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Optional..." className={inputCls} />
						</div>
					</div>

					{/* Type selector */}
					<div>
						<label className={labelCls}>Trigger Type</label>
						<div className="grid grid-cols-4 gap-2">
							{(['webhook', 'schedule', 'event', 'condition'] as TriggerType[]).map((t) => {
								const meta = TYPE_META[t];
								const selected = form.type === t;
								return (
									<button
										key={t}
										type="button"
										onClick={() => setField('type', t)}
										className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-xs transition-colors ${
											selected
												? 'bg-[#1c1c1c] border-[#22c55e] text-[#fafafa]'
												: 'bg-[#0a0a0a] border-[#262626] text-[#525252] hover:border-[#3f3f46]'
										}`}
									>
										<span style={{ color: selected ? undefined : '#525252' }}>{meta.icon}</span>
										<span>{meta.label}</span>
									</button>
								);
							})}
						</div>
					</div>

					{/* Dynamic config */}
					<div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3 space-y-3">
						<p className="text-[11px] text-[#525252] uppercase tracking-wider font-medium">Config</p>

						{form.type === 'webhook' && (
							<>
								<div className="grid grid-cols-3 gap-2">
									<div className="col-span-2">
										<label className={labelCls}>URL</label>
										<input type="text" value={form.wh_url} onChange={(e) => setField('wh_url', e.target.value)} placeholder="https://..." className={inputCls} />
									</div>
									<div>
										<label className={labelCls}>Method</label>
										<select value={form.wh_method} onChange={(e) => setField('wh_method', e.target.value)} className={selectCls}>
											{['GET', 'POST', 'PUT', 'PATCH'].map((m) => <option key={m}>{m}</option>)}
										</select>
									</div>
								</div>
								<div>
									<label className={labelCls}>Headers (JSON)</label>
									<textarea value={form.wh_headers} onChange={(e) => setField('wh_headers', e.target.value)} placeholder={'{"Authorization": "Bearer ..."}'} rows={2} className={`${inputCls} resize-none`} />
								</div>
							</>
						)}

						{form.type === 'schedule' && (
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className={labelCls}>Cron Expression</label>
									<input type="text" value={form.sc_cron} onChange={(e) => setField('sc_cron', e.target.value)} placeholder="0 * * * *" className={inputCls} />
									{form.sc_cron && <p className="text-[10px] text-[#525252] mt-1">{cronHuman(form.sc_cron)}</p>}
								</div>
								<div>
									<label className={labelCls}>Timezone</label>
									<input type="text" value={form.sc_timezone} onChange={(e) => setField('sc_timezone', e.target.value)} placeholder="UTC" className={inputCls} />
								</div>
							</div>
						)}

						{form.type === 'event' && (
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className={labelCls}>Event Type</label>
									<select value={form.ev_type} onChange={(e) => setField('ev_type', e.target.value)} className={selectCls}>
										{EVENT_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
									</select>
								</div>
								<div>
									<label className={labelCls}>Filter Conditions</label>
									<input type="text" value={form.ev_filter} onChange={(e) => setField('ev_filter', e.target.value)} placeholder="agent_id=xyz" className={inputCls} />
								</div>
							</div>
						)}

						{form.type === 'condition' && (
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className={labelCls}>Metric</label>
									<select value={form.co_metric} onChange={(e) => setField('co_metric', e.target.value)} className={selectCls}>
										{['error_rate', 'latency', 'token_count', 'failure_count'].map((m) => (
											<option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
										))}
									</select>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<div>
										<label className={labelCls}>Operator</label>
										<select value={form.co_operator} onChange={(e) => setField('co_operator', e.target.value)} className={selectCls}>
											{['>', '<', '>=', '<=', '=='].map((op) => <option key={op}>{op}</option>)}
										</select>
									</div>
									<div>
										<label className={labelCls}>Threshold</label>
										<input type="number" value={form.co_threshold} onChange={(e) => setField('co_threshold', e.target.value)} className={inputCls} />
									</div>
								</div>
								<div>
									<label className={labelCls}>Check Interval (min)</label>
									<input type="number" value={form.co_check_interval} onChange={(e) => setField('co_check_interval', e.target.value)} className={inputCls} />
								</div>
							</div>
						)}
					</div>

					{/* Action */}
					<div className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-3 space-y-3">
						<p className="text-[11px] text-[#525252] uppercase tracking-wider font-medium">Action</p>
						<div>
							<label className={labelCls}>Action Type</label>
							<select value={form.ac_type} onChange={(e) => setField('ac_type', e.target.value as ActionType)} className={selectCls}>
								{(Object.entries(ACTION_LABELS) as [ActionType, string][]).map(([k, v]) => (
									<option key={k} value={k}>{v}</option>
								))}
							</select>
						</div>
						{form.ac_type === 'run_agent' && (
							<div>
								<label className={labelCls}>Agent Name</label>
								<input type="text" value={form.ac_agent_name} onChange={(e) => setField('ac_agent_name', e.target.value)} placeholder="researcher" className={inputCls} />
							</div>
						)}
						{form.ac_type === 'send_webhook' && (
							<div>
								<label className={labelCls}>Webhook URL</label>
								<input type="text" value={form.ac_webhook_url} onChange={(e) => setField('ac_webhook_url', e.target.value)} placeholder="https://..." className={inputCls} />
							</div>
						)}
						{form.ac_type === 'execute_pipeline' && (
							<div>
								<label className={labelCls}>Pipeline Name</label>
								<input type="text" value={form.ac_pipeline} onChange={(e) => setField('ac_pipeline', e.target.value)} placeholder="data-processing" className={inputCls} />
							</div>
						)}
						{form.ac_type === 'notify' && (
							<div>
								<label className={labelCls}>Message</label>
								<input type="text" value={form.ac_message} onChange={(e) => setField('ac_message', e.target.value)} placeholder="Notification message..." className={inputCls} />
							</div>
						)}
					</div>

					{/* Enabled toggle */}
					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={() => setField('enabled', !form.enabled)}
							className="text-[#525252] hover:text-[#a3a3a3] transition-colors"
						>
							{form.enabled
								? <ToggleRight className="w-7 h-7 text-[#22c55e]" />
								: <ToggleLeft className="w-7 h-7" />}
						</button>
						<span className="text-xs text-[#a3a3a3]">{form.enabled ? 'Enabled' : 'Disabled'}</span>
					</div>

					{error && (
						<p className="text-xs text-[#ef4444] bg-[#450a0a] border border-[#b91c1c] rounded-md px-3 py-2">
							{error}
						</p>
					)}
				</form>

				{/* Footer */}
				<div className="flex items-center gap-2 px-5 py-4 border-t border-[#262626]">
					<button
						onClick={(e) => { void submit(e as unknown as React.FormEvent); }}
						disabled={loading}
						className="px-4 py-1.5 text-xs bg-[#22c55e] text-[#0a0a0a] font-medium rounded-md hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
					>
						{loading ? 'Saving...' : editing ? 'Update' : 'Create'}
					</button>
					<button
						onClick={onClose}
						className="px-4 py-1.5 text-xs bg-[#1c1c1c] text-[#a3a3a3] border border-[#262626] rounded-md hover:border-[#3f3f46] transition-colors"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}
