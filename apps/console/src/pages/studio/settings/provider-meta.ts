// ---------------------------------------------------------------------------
// ProvidersPage Types & Metadata
// ---------------------------------------------------------------------------

import { MODEL_OPTIONS } from '../../lib/model-options';
import type { AIProviderType } from '../../lib/studio-api';

export interface ProviderMeta {
	label: string;
	defaultBaseUrl: string;
	defaultModel: string;
	models: string[];
	color: string;
}

export const PROVIDER_META: Record<AIProviderType, ProviderMeta> = {
	openai: {
		label: 'OpenAI',
		defaultBaseUrl: '',
		defaultModel: 'gpt-4o-mini',
		models: MODEL_OPTIONS.openai,
		color: 'text-[#10a37f]',
	},
	anthropic: {
		label: 'Anthropic',
		defaultBaseUrl: '',
		defaultModel: 'claude-sonnet-4-20250514',
		models: MODEL_OPTIONS.anthropic,
		color: 'text-[#d97706]',
	},
	google: {
		label: 'Google',
		defaultBaseUrl: '',
		defaultModel: 'gemini-2.0-flash',
		models: MODEL_OPTIONS.google,
		color: 'text-[#4285f4]',
	},
	ollama: {
		label: 'Ollama',
		defaultBaseUrl: 'http://localhost:11434',
		defaultModel: 'llama3',
		models: MODEL_OPTIONS.ollama,
		color: 'text-[#a855f7]',
	},
	custom: {
		label: 'Custom',
		defaultBaseUrl: '',
		defaultModel: '',
		models: [],
		color: 'text-[#a3a3a3]',
	},
};

export const PROVIDER_TYPE_ORDER: AIProviderType[] = ['openai', 'anthropic', 'google', 'ollama', 'custom'];

export function providerStatusColor(status: string): string {
	switch (status) {
		case 'healthy':
			return 'text-[#22c55e]';
		case 'degraded':
			return 'text-[#fbbf24]';
		case 'unhealthy':
			return 'text-[#f87171]';
		default:
			return 'text-[#525252]';
	}
}

export function providerStatusDot(status: string): string {
	switch (status) {
		case 'healthy':
			return 'bg-[#22c55e]';
		case 'degraded':
			return 'bg-[#fbbf24]';
		case 'unhealthy':
			return 'bg-[#f87171]';
		default:
			return 'bg-[#525252]';
	}
}
