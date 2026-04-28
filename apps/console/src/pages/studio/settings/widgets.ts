// ---------------------------------------------------------------------------
// Oscorpex — Project Settings Widget Definitions
// ---------------------------------------------------------------------------

export interface WidgetField {
	key: string;
	label: string;
	type: 'toggle' | 'text' | 'password' | 'number' | 'select';
	options?: { label: string; value: string }[];
	placeholder?: string;
	defaultValue: string;
}

export interface WidgetDef {
	category: string;
	title: string;
	icon: string;
	color: string;
	description: string;
	fields: WidgetField[];
}

export const WIDGETS: WidgetDef[] = [
	{
		category: 'sonarqube',
		title: 'SonarQube',
		icon: '\u{1F6E1}',
		color: '#a78bfa',
		description: 'Kod kalitesi analizi ve quality gate kontrolu. Docker uzerinde calisir.',
		fields: [
			{ key: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'false' },
			{ key: 'hostUrl', label: 'Host URL', type: 'text', placeholder: 'http://localhost:9000', defaultValue: 'http://localhost:9000' },
			{ key: 'token', label: 'Token', type: 'password', placeholder: 'squ_...', defaultValue: '' },
		],
	},
	{
		category: 'eslint',
		title: 'ESLint',
		icon: '\u{1F4DD}',
		color: '#60a5fa',
		description: 'Task tamamlandiginda otomatik eslint --fix calistirir.',
		fields: [
			{ key: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'true' },
			{
				key: 'preset',
				label: 'Rule Set',
				type: 'select',
				options: [
					{ label: 'Recommended', value: 'recommended' },
					{ label: 'Strict', value: 'strict' },
					{ label: 'Custom', value: 'custom' },
				],
				defaultValue: 'recommended',
			},
		],
	},
	{
		category: 'prettier',
		title: 'Prettier',
		icon: '\u{1F3A8}',
		color: '#f472b6',
		description: 'Task tamamlandiginda otomatik prettier --write calistirir.',
		fields: [
			{ key: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'true' },
			{ key: 'printWidth', label: 'Print Width', type: 'number', placeholder: '100', defaultValue: '100' },
			{
				key: 'singleQuote',
				label: 'Single Quote',
				type: 'select',
				options: [
					{ label: 'Yes', value: 'true' },
					{ label: 'No', value: 'false' },
				],
				defaultValue: 'true',
			},
			{
				key: 'trailingComma',
				label: 'Trailing Comma',
				type: 'select',
				options: [
					{ label: 'All', value: 'all' },
					{ label: 'ES5', value: 'es5' },
					{ label: 'None', value: 'none' },
				],
				defaultValue: 'all',
			},
		],
	},
	{
		category: 'ai_model',
		title: 'AI Model',
		icon: '\u{1F916}',
		color: '#34d399',
		description: "Agent'larin kullandigi AI model ve provider ayarlari.",
		fields: [
			{
				key: 'provider',
				label: 'Provider',
				type: 'select',
				options: [
					{ label: 'OpenAI', value: 'openai' },
					{ label: 'Anthropic', value: 'anthropic' },
					{ label: 'Google', value: 'google' },
					{ label: 'Ollama', value: 'ollama' },
				],
				defaultValue: 'openai',
			},
			{ key: 'model', label: 'Model', type: 'text', placeholder: 'gpt-4o', defaultValue: '' },
			{ key: 'maxRetries', label: 'Max Retries', type: 'number', placeholder: '8', defaultValue: '8' },
			{ key: 'timeout', label: 'Timeout (min)', type: 'number', placeholder: '5', defaultValue: '5' },
		],
	},
	{
		category: 'auto_docs',
		title: 'Otomatik Dokumantasyon',
		icon: '\u{1F4C4}',
		color: '#fbbf24',
		description: 'Agent rollere gore docs/ dosyalarini otomatik doldurur.',
		fields: [
			{ key: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'true' },
			{ key: 'projectMd', label: 'PROJECT.md (PM)', type: 'toggle', defaultValue: 'true' },
			{ key: 'architectureMd', label: 'ARCHITECTURE.md (Architect)', type: 'toggle', defaultValue: 'true' },
			{ key: 'apiContractMd', label: 'API_CONTRACT.md (Backend)', type: 'toggle', defaultValue: 'true' },
			{ key: 'changelogMd', label: 'CHANGELOG.md (All)', type: 'toggle', defaultValue: 'true' },
		],
	},
	{
		category: 'budget',
		title: 'Budget Limiti',
		icon: '\u{1F4B0}',
		color: '#f87171',
		description: 'Proje bazinda maliyet limiti. Limit asildiginda execution durur.',
		fields: [
			{ key: 'enabled', label: 'Enabled', type: 'toggle', defaultValue: 'false' },
			{ key: 'maxCostUsd', label: 'Max Cost ($)', type: 'number', placeholder: '10.00', defaultValue: '' },
			{ key: 'warningThreshold', label: 'Warning Threshold ($)', type: 'number', placeholder: '8.00', defaultValue: '' },
		],
	},
	{
		category: 'scoring',
		title: 'Ajan Puanlama',
		icon: '\u{2B50}',
		color: '#facc15',
		description: 'Ajan performans skoru agirlik ve baseline ayarlari.',
		fields: [
			{ key: 'w_success', label: 'Success Rate Weight (%)', type: 'number', placeholder: '30', defaultValue: '30' },
			{ key: 'w_firstPass', label: 'First Pass Weight (%)', type: 'number', placeholder: '25', defaultValue: '25' },
			{ key: 'w_review', label: 'Review Approval Weight (%)', type: 'number', placeholder: '20', defaultValue: '20' },
			{ key: 'w_time', label: 'Speed Weight (%)', type: 'number', placeholder: '15', defaultValue: '15' },
			{ key: 'w_cost', label: 'Cost Weight (%)', type: 'number', placeholder: '10', defaultValue: '10' },
			{ key: 'baselineTimeMin', label: 'Speed Baseline (min)', type: 'number', placeholder: '30', defaultValue: '30' },
			{ key: 'baselineCostUsd', label: 'Cost Baseline ($)', type: 'number', placeholder: '0.50', defaultValue: '0.50' },
		],
	},
	{
		category: 'model_routing',
		title: 'Model Routing',
		icon: '\u{1F9E0}',
		color: '#38bdf8',
		description: 'Task karmasikligina gore AI model atamasi (S/M/L/XL). Bos birakirsan varsayilan kullanilir.',
		fields: [
			{ key: 'S', label: 'S (Kucuk)', type: 'text', placeholder: 'claude-haiku-4-5-20251001', defaultValue: '' },
			{ key: 'M', label: 'M (Orta)', type: 'text', placeholder: 'claude-sonnet-4-6', defaultValue: '' },
			{ key: 'L', label: 'L (Buyuk)', type: 'text', placeholder: 'claude-sonnet-4-6', defaultValue: '' },
			{ key: 'XL', label: 'XL (Cok Buyuk)', type: 'text', placeholder: 'claude-opus-4-6', defaultValue: '' },
		],
	},
	{
		category: 'policy',
		title: 'Governance Policy',
		icon: '\u{1F6E1}',
		color: '#fb923c',
		description: 'Task dispatch oncesi politika kontrolu. Asim durumunda task bloklanir veya uyari verilir.',
		fields: [
			{ key: 'task_budget_usd', label: 'Max Cost per Task ($)', type: 'number', placeholder: '5.00', defaultValue: '' },
			{ key: 'multi_reviewer_pattern', label: 'Multi Reviewer Pattern (regex)', type: 'text', placeholder: 'src/auth/.*', defaultValue: '' },
		],
	},
];
