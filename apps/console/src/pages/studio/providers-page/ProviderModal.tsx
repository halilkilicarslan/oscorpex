// ---------------------------------------------------------------------------
// Provider Modal (Add / Edit)
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { X, Eye, EyeOff, ToggleLeft, ToggleRight } from 'lucide-react';
import { createProvider, updateProvider, type AIProvider, type AIProviderType, type ProviderCliTool } from '../../../lib/studio-api';
import { PROVIDER_META } from '../settings/provider-meta.js';

export interface FormState {
	name: string;
	type: AIProviderType;
	apiKey: string;
	baseUrl: string;
	model: string;
	isActive: boolean;
	cliTool: ProviderCliTool;
}

const EMPTY_FORM: FormState = {
	name: '',
	type: 'openai',
	apiKey: '',
	baseUrl: '',
	model: 'gpt-4o-mini',
	isActive: true,
	cliTool: 'claude',
};

interface ProviderModalProps {
	provider?: AIProvider;
	onClose: () => void;
	onSaved: (p: AIProvider) => void;
}

export default function ProviderModal({ provider, onClose, onSaved }: ProviderModalProps) {
	const isEdit = !!provider;

	const [form, setForm] = useState<FormState>(() => {
		if (provider) {
			return {
				name: provider.name,
				type: provider.type,
				apiKey: provider.apiKey,
				baseUrl: provider.baseUrl,
				model: provider.model,
				isActive: provider.isActive,
				cliTool: provider.cliTool ?? 'claude',
			};
		}
		return { ...EMPTY_FORM };
	});

	const [showApiKey, setShowApiKey] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	const handleTypeChange = (type: AIProviderType) => {
		const meta = PROVIDER_META[type];
		setForm((prev) => ({
			...prev,
			type,
			baseUrl: meta.defaultBaseUrl,
			model: meta.defaultModel,
		}));
	};

	const handleSubmit = async () => {
		if (!form.name.trim()) {
			setError('Name is required');
			return;
		}
		setError('');
		setLoading(true);
		try {
			let saved: AIProvider;
			if (isEdit && provider) {
				saved = await updateProvider(provider.id, {
					name: form.name.trim(),
					type: form.type,
					...(form.apiKey !== provider.apiKey ? { apiKey: form.apiKey } : {}),
					baseUrl: form.baseUrl,
					model: form.model,
					isActive: form.isActive,
					cliTool: form.type === 'cli' ? form.cliTool : undefined,
				});
			} else {
				saved = await createProvider({
					name: form.name.trim(),
					type: form.type,
					apiKey: form.apiKey,
					baseUrl: form.baseUrl,
					model: form.model,
					isActive: form.isActive,
					cliTool: form.type === 'cli' ? form.cliTool : undefined,
				});
			}
			onSaved(saved);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save provider');
		} finally {
			setLoading(false);
		}
	};

	const requiresBaseUrl = form.type === 'ollama' || form.type === 'custom';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div className="bg-[#111111] border border-[#262626] rounded-2xl w-full max-w-md p-6">
				<div className="flex items-center justify-between mb-5">
					<h2 className="text-[16px] font-semibold text-[#fafafa]">
						{isEdit ? 'Edit Provider' : 'Add Provider'}
					</h2>
					<button
						onClick={onClose}
						className="p-1 rounded hover:bg-[#1f1f1f] text-[#525252] hover:text-[#a3a3a3]"
					>
						<X size={18} />
					</button>
				</div>

				<div className="flex flex-col gap-4">
					<div>
						<label className="text-[12px] text-[#737373] font-medium block mb-1.5">
							Name <span className="text-[#ef4444]">*</span>
						</label>
						<input
							type="text"
							value={form.name}
							onChange={(e) => set('name', e.target.value)}
							placeholder="My OpenAI Provider"
							autoFocus
							className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
						/>
					</div>

					<div>
						<label className="text-[12px] text-[#737373] font-medium block mb-1.5">Provider Type</label>
						<select
							value={form.type}
							onChange={(e) => handleTypeChange(e.target.value as AIProviderType)}
							className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none appearance-none"
						>
							<option value="openai">OpenAI</option>
							<option value="anthropic">Anthropic</option>
							<option value="google">Google</option>
							<option value="ollama">Ollama (local)</option>
							<option value="custom">Custom</option>
							<option value="cli">CLI (local, no API key)</option>
						</select>
					</div>

					{form.type === 'cli' && (
						<div>
							<label className="text-[12px] text-[#737373] font-medium block mb-1.5">
								CLI Tool <span className="text-[#ef4444]">*</span>
							</label>
							<select
								value={form.cliTool}
								onChange={(e) => set('cliTool', e.target.value as ProviderCliTool)}
								className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none appearance-none"
							>
								<option value="claude">Claude (claude CLI)</option>
								<option value="codex">Codex (codex CLI)</option>
								<option value="gemini">Gemini (gemini CLI)</option>
							</select>
							<p className="text-[11px] text-[#525252] mt-1.5">
								Uses your locally installed CLI — no API key needed. Ensure the binary is in PATH.
							</p>
						</div>
					)}

					{form.type !== 'cli' && (
						<div>
							<label className="text-[12px] text-[#737373] font-medium block mb-1.5">
								API Key
								{form.type === 'ollama' && <span className="ml-1 text-[#525252]">(not required for Ollama)</span>}
							</label>
							<div className="relative">
								<input
									type={showApiKey ? 'text' : 'password'}
									value={form.apiKey}
									onChange={(e) => set('apiKey', e.target.value)}
									placeholder={isEdit ? 'Leave blank to keep existing key' : 'sk-...'}
									className="w-full px-3 py-2 pr-10 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none font-mono"
								/>
								<button
									type="button"
									onClick={() => setShowApiKey((v) => !v)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#a3a3a3] transition-colors"
								>
									{showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
								</button>
							</div>
						</div>
					)}

					{form.type !== 'cli' && (
						<div>
							<label className="text-[12px] text-[#737373] font-medium block mb-1.5">
								Base URL
								{requiresBaseUrl && <span className="ml-1 text-[#ef4444]">*</span>}
								{!requiresBaseUrl && <span className="ml-1 text-[#525252]">(optional)</span>}
							</label>
							<input
								type="text"
								value={form.baseUrl}
								onChange={(e) => set('baseUrl', e.target.value)}
								placeholder={
									form.type === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'
								}
								className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
							/>
						</div>
					)}

					<div>
						<label className="text-[12px] text-[#737373] font-medium block mb-1.5">Model</label>
						{PROVIDER_META[form.type].models.length > 0 ? (
							<select
								value={form.model}
								onChange={(e) => set('model', e.target.value)}
								className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] focus:border-[#22c55e] focus:outline-none appearance-none"
							>
								{PROVIDER_META[form.type].models.map((m) => (
									<option key={m} value={m}>{m}</option>
								))}
							</select>
						) : (
							<input
								type="text"
								value={form.model}
								onChange={(e) => set('model', e.target.value)}
								placeholder="model-name"
								className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
							/>
						)}
					</div>

					<div className="flex items-center justify-between">
						<span className="text-[12px] text-[#737373] font-medium">Active</span>
						<button type="button" onClick={() => set('isActive', !form.isActive)} className="transition-colors">
							{form.isActive ? (
								<ToggleRight size={24} className="text-[#22c55e]" />
							) : (
								<ToggleLeft size={24} className="text-[#525252]" />
							)}
						</button>
					</div>
				</div>

				{error && <p className="mt-3 text-[12px] text-[#ef4444]">{error}</p>}

				<div className="flex justify-end gap-2 mt-6">
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-[13px] text-[#a3a3a3] hover:text-[#fafafa] border border-[#262626] hover:border-[#333] transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={handleSubmit}
						disabled={!form.name.trim() || loading}
						className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Provider'}
					</button>
				</div>
			</div>
		</div>
	);
}
