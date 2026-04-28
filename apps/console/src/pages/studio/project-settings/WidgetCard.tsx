// ---------------------------------------------------------------------------
// Widget Card
// ---------------------------------------------------------------------------

import { Save, CheckCircle2, Loader2 } from 'lucide-react';
import { Toggle } from './helpers.js';
import type { WidgetDef } from '../settings/widgets.js';

interface WidgetCardProps {
	widget: WidgetDef;
	values: Record<string, string>;
	onChange: (key: string, value: string) => void;
	onSave: () => void;
	saving: boolean;
	saved: boolean;
}

export default function WidgetCard({ widget, values, onChange, onSave, saving, saved }: WidgetCardProps) {
	const isEnabled = values['enabled'] !== 'false';
	const hasEnabledToggle = widget.fields.some((f) => f.key === 'enabled');

	return (
		<div
			className={`bg-[#111111] border rounded-xl overflow-hidden transition-all ${
				hasEnabledToggle && !isEnabled ? 'border-[#1a1a1a] opacity-60' : 'border-[#262626]'
			}`}
		>
			<div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a1a1a]">
				<span className="text-base">{widget.icon}</span>
				<h3 className="text-[12px] font-semibold text-[#fafafa]">{widget.title}</h3>
				<span className="ml-auto flex items-center gap-2">
					{saved && (
						<span className="flex items-center gap-1 text-[10px] text-[#22c55e]">
							<CheckCircle2 size={10} /> Saved
						</span>
					)}
					<button
						onClick={onSave}
						disabled={saving}
						className="flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#a3a3a3] transition-colors disabled:opacity-50"
					>
						{saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
						Save
					</button>
				</span>
			</div>

			<div className="px-4 py-2">
				<p className="text-[10px] text-[#525252]">{widget.description}</p>
			</div>

			<div className="px-4 pb-3 space-y-2.5">
				{widget.fields.map((field) => (
					<div key={field.key} className="flex items-center justify-between gap-3">
						<label className="text-[11px] text-[#a3a3a3] shrink-0 min-w-[100px]">{field.label}</label>

						{field.type === 'toggle' && (
							<Toggle
								value={values[field.key] === 'true'}
								onChange={(v) => onChange(field.key, v ? 'true' : 'false')}
							/>
						)}

						{field.type === 'text' && (
							<input
								type="text"
								value={values[field.key] || ''}
								onChange={(e) => onChange(field.key, e.target.value)}
								placeholder={field.placeholder}
								className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040] max-w-[200px]"
							/>
						)}

						{field.type === 'password' && (
							<input
								type="password"
								value={values[field.key] || ''}
								onChange={(e) => onChange(field.key, e.target.value)}
								placeholder={field.placeholder}
								className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040] max-w-[200px]"
							/>
						)}

						{field.type === 'number' && (
							<input
								type="number"
								value={values[field.key] || ''}
								onChange={(e) => onChange(field.key, e.target.value)}
								placeholder={field.placeholder}
								className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] placeholder:text-[#333] focus:outline-none focus:border-[#404040] max-w-[120px]"
							/>
						)}

						{field.type === 'select' && (
							<select
								value={values[field.key] || field.defaultValue}
								onChange={(e) => onChange(field.key, e.target.value)}
								className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-md px-2.5 py-1 text-[11px] text-[#fafafa] focus:outline-none focus:border-[#404040] max-w-[200px]"
							>
								{field.options?.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
