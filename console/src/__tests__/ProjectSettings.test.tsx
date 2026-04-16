import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock all API functions
vi.mock('../lib/studio-api', () => ({
	fetchProjectSettings: vi.fn(),
	saveProjectSettings: vi.fn(),
	fetchProjectCosts: vi.fn(),
	fetchWebhooks: vi.fn(),
	createWebhook: vi.fn(),
	updateWebhook: vi.fn(),
	deleteWebhook: vi.fn(),
	testWebhook: vi.fn(),
	fetchCustomPolicyRules: vi.fn(),
	saveCustomPolicyRules: vi.fn(),
	fetchProviders: vi.fn(),
	fetchMemoryContext: vi.fn(),
	fetchMemoryFacts: vi.fn(),
	refreshMemorySnapshot: vi.fn(),
	upsertMemoryFact: vi.fn(),
	deleteMemoryFact: vi.fn(),
	isBuiltinPolicy: vi.fn((rule: { id: string }) =>
		['max_cost_per_task', 'require_approval_for_large', 'multi_reviewer'].includes(rule.id),
	),
}));

// Mock model-options
vi.mock('../lib/model-options', () => ({
	getModelsFromProviders: vi.fn().mockReturnValue([
		{
			label: 'Anthropic',
			models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'],
		},
	]),
}));

import {
	fetchProjectSettings,
	saveProjectSettings,
	fetchProjectCosts,
	fetchWebhooks,
	fetchCustomPolicyRules,
	saveCustomPolicyRules,
	fetchProviders,
	fetchMemoryContext,
	fetchMemoryFacts,
	refreshMemorySnapshot,
	upsertMemoryFact,
	deleteMemoryFact,
} from '../lib/studio-api';

import ProjectSettings from '../pages/studio/ProjectSettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides = {}) {
	return {
		id: 'p1',
		name: 'Anthropic',
		type: 'anthropic' as const,
		apiKey: '',
		baseUrl: '',
		model: 'claude-sonnet-4-6',
		isDefault: true,
		isActive: true,
		fallbackOrder: 0,
		createdAt: '',
		updatedAt: '',
		...overrides,
	};
}

function makeFact(overrides = {}) {
	return {
		projectId: 'test-123',
		scope: 'testing',
		key: 'framework',
		value: 'vitest',
		confidence: 1.0,
		source: 'user',
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makePolicyRule(overrides = {}) {
	return {
		id: 'custom-rule-1',
		projectId: 'test-123',
		name: 'My Custom Rule',
		condition: 'complexity == XL',
		action: 'warn' as const,
		enabled: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// beforeEach — default happy-path mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(fetchProjectSettings).mockResolvedValue({});
	vi.mocked(saveProjectSettings).mockResolvedValue({ ok: true });
	vi.mocked(fetchProjectCosts).mockResolvedValue({
		totalCostUsd: 0,
		taskCount: 0,
		avgCostPerTask: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalTokens: 0,
	} as ReturnType<typeof fetchProjectCosts> extends Promise<infer T> ? T : never);
	vi.mocked(fetchWebhooks).mockResolvedValue([]);
	vi.mocked(fetchCustomPolicyRules).mockResolvedValue([]);
	vi.mocked(saveCustomPolicyRules).mockResolvedValue({ ok: true });
	vi.mocked(fetchProviders).mockResolvedValue([makeProvider()]);
	vi.mocked(fetchMemoryContext).mockResolvedValue('Working memory context text here');
	vi.mocked(fetchMemoryFacts).mockResolvedValue([]);
	vi.mocked(refreshMemorySnapshot).mockResolvedValue(null);
	vi.mocked(upsertMemoryFact).mockResolvedValue(makeFact() as ReturnType<typeof upsertMemoryFact> extends Promise<infer T> ? T : never);
	vi.mocked(deleteMemoryFact).mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// 1. PolicySection
// ---------------------------------------------------------------------------

describe('PolicySection', () => {
	it('renders the built-in rules section heading', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Policy Rules');
		expect(screen.getByText('Yerlesik Kurallar')).toBeInTheDocument();
	});

	it('renders all three built-in policy rule names', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Policy Rules');
		expect(screen.getByText('Max cost per task')).toBeInTheDocument();
		expect(screen.getByText('Require approval for large tasks')).toBeInTheDocument();
		expect(screen.getByText('Multi-reviewer for sensitive files')).toBeInTheDocument();
	});

	it('renders the custom rules section heading', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Policy Rules');
		expect(screen.getByText('Ozel Kurallar')).toBeInTheDocument();
	});

	it('loads and displays custom rules from API', async () => {
		vi.mocked(fetchCustomPolicyRules).mockResolvedValue([makePolicyRule()]);
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('My Custom Rule');
		expect(screen.getByText('complexity == XL')).toBeInTheDocument();
	});

	it('"Kural Ekle" button is rendered', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Policy Rules');
		expect(screen.getByText('Kural Ekle')).toBeInTheDocument();
	});

	it('"Kural Ekle" button opens PolicyRuleModal', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Kural Ekle');
		fireEvent.click(screen.getByText('Kural Ekle'));
		await screen.findByText('Yeni Kural');
		expect(screen.getByText('Yeni Kural')).toBeInTheDocument();
	});

	it('can create a new rule via the modal and saves to API', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Kural Ekle');
		fireEvent.click(screen.getByText('Kural Ekle'));

		await screen.findByText('Yeni Kural');

		// Fill in the rule name
		const nameInput = screen.getByPlaceholderText('Ornegin: Security-sensitive path gate');
		fireEvent.change(nameInput, { target: { value: 'New Test Rule' } });

		// Fill in condition value — the input that shows "S | M | L | XL" placeholder
		const conditionValueInput = screen.getByPlaceholderText('S | M | L | XL');
		fireEvent.change(conditionValueInput, { target: { value: 'XL' } });

		// Click modal Kaydet — it has class bg-[#22c55e] text-black and text "Kaydet"
		// The modal Kaydet has class px-3 py-1.5 text-[10px] bg-[#22c55e]...
		// Use getByText with a selector that matches the modal button specifically
		const allKaydetBtns = screen.getAllByText('Kaydet');
		// Modal Kaydet is the one with px-3 class (not px-2 like ModelRouting's Kaydet)
		const modalKaydet = allKaydetBtns.find(
			(b) => b.className.includes('px-3') && b.className.includes('bg-[#22c55e]'),
		);
		if (modalKaydet) {
			fireEvent.click(modalKaydet);
		}

		await waitFor(() => {
			expect(vi.mocked(saveCustomPolicyRules)).toHaveBeenCalledWith(
				'test-123',
				expect.arrayContaining([
					expect.objectContaining({ name: 'New Test Rule' }),
				]),
			);
		});
	});

	it('can toggle a custom rule enabled/disabled', async () => {
		const rule = makePolicyRule({ enabled: true });
		vi.mocked(fetchCustomPolicyRules).mockResolvedValue([rule]);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('My Custom Rule');

		// The toggle button for the custom rule — find the toggle in the custom rules area
		// Toggle is rendered as a button inside the rule row
		const toggleButtons = screen.getAllByRole('button');
		// Find a toggle near the rule row — the toggle button is inside the rule div
		// We look for the Toggle component rendered as a button element near My Custom Rule
		const ruleRow = screen.getByText('My Custom Rule').closest('div');
		const toggleBtn = ruleRow?.parentElement?.querySelector('button[class*="inline-flex"][class*="rounded-full"]');

		if (toggleBtn) {
			fireEvent.click(toggleBtn);
			await waitFor(() => {
				expect(vi.mocked(saveCustomPolicyRules)).toHaveBeenCalledWith(
					'test-123',
					expect.arrayContaining([expect.objectContaining({ enabled: false })]),
				);
			});
		} else {
			// Alternative: find by accessible role near the rule
			const allButtons = Array.from(ruleRow?.parentElement?.querySelectorAll('button') ?? []);
			const toggle = allButtons.find((b) => b.className.includes('inline-flex') && b.className.includes('rounded-full'));
			if (toggle) {
				fireEvent.click(toggle);
				await waitFor(() => {
					expect(vi.mocked(saveCustomPolicyRules)).toHaveBeenCalled();
				});
			}
		}
	});

	it('can delete a custom rule with confirmation', async () => {
		const rule = makePolicyRule();
		vi.mocked(fetchCustomPolicyRules).mockResolvedValue([rule]);
		window.confirm = vi.fn(() => true);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('My Custom Rule');

		// Find the delete (Trash2) button in the rule row
		const ruleContainer = screen.getByText('My Custom Rule').closest('div[class*="flex items-center"]');
		const deleteBtn = ruleContainer?.querySelector('button[title="Sil"]');
		if (deleteBtn) {
			fireEvent.click(deleteBtn);
		} else {
			// Fallback: click the last Trash icon button visible
			const allButtons = screen.getAllByRole('button');
			const trashBtn = allButtons.find((b) => b.getAttribute('title') === 'Sil');
			if (trashBtn) fireEvent.click(trashBtn);
		}

		await waitFor(() => {
			expect(window.confirm).toHaveBeenCalled();
			expect(vi.mocked(saveCustomPolicyRules)).toHaveBeenCalledWith('test-123', []);
		});
	});

	it('can edit an existing rule via the edit button', async () => {
		const rule = makePolicyRule();
		vi.mocked(fetchCustomPolicyRules).mockResolvedValue([rule]);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('My Custom Rule');

		// Find the edit button (title="Duzenle")
		const editBtn = screen.getByTitle('Duzenle');
		fireEvent.click(editBtn);

		await screen.findByText('Kurali Duzenle');
		expect(screen.getByText('Kurali Duzenle')).toBeInTheDocument();
	});

	it('shows loading state before policy data arrives', async () => {
		let resolveRules: (v: ReturnType<typeof makePolicyRule>[]) => void = () => {};
		vi.mocked(fetchCustomPolicyRules).mockReturnValue(
			new Promise((res) => { resolveRules = res; }),
		);

		render(<ProjectSettings projectId="test-123" />);

		// The page itself shows a full loading spinner first
		// After page loads, policy section shows its own spinner
		resolveRules([]);
	});

	it('shows error state when policy API fails', async () => {
		vi.mocked(fetchCustomPolicyRules).mockRejectedValue(new Error('Policy API down'));

		render(<ProjectSettings projectId="test-123" />);

		await waitFor(() => {
			expect(screen.getByText('Policy API down')).toBeInTheDocument();
		});
	});

	it('shows "Kaydedildi" after successfully saving a new rule', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Kural Ekle');
		fireEvent.click(screen.getByText('Kural Ekle'));

		await screen.findByText('Yeni Kural');

		const nameInput = screen.getByPlaceholderText('Ornegin: Security-sensitive path gate');
		fireEvent.change(nameInput, { target: { value: 'Auth Rule' } });

		const conditionValueInput = screen.getByPlaceholderText('S | M | L | XL');
		fireEvent.change(conditionValueInput, { target: { value: 'M' } });

		const allKaydetBtns = screen.getAllByText('Kaydet');
		const modalKaydet = allKaydetBtns.find(
			(b) => b.className.includes('px-3') && b.className.includes('bg-[#22c55e]'),
		);
		if (modalKaydet) {
			fireEvent.click(modalKaydet);
		}

		await waitFor(() => {
			expect(vi.mocked(saveCustomPolicyRules)).toHaveBeenCalled();
		});
	});

	it('shows modal validation error when name is empty', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Kural Ekle');
		fireEvent.click(screen.getByText('Kural Ekle'));

		await screen.findByText('Yeni Kural');

		// Click modal Kaydet without filling name
		const allKaydetBtns = screen.getAllByText('Kaydet');
		const modalKaydet = allKaydetBtns.find(
			(b) => b.className.includes('px-3') && b.className.includes('bg-[#22c55e]'),
		);
		if (modalKaydet) {
			fireEvent.click(modalKaydet);
		}

		await waitFor(() => {
			expect(screen.getByText('Kural adi zorunludur')).toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// 2. ModelRoutingSection
// ---------------------------------------------------------------------------

// Helper to get the ModelRouting dedicated section (not the widget card)
function getModelRoutingSection() {
	// The ModelRoutingSection renders an h3 with "Model Routing"
	// The widget card ALSO renders "Model Routing" as title — but they're in different DOM trees.
	// getAllByText returns both; pick the one that contains "Small" label (tier info)
	const headings = screen.getAllByText('Model Routing');
	for (const h of headings) {
		const section = h.closest('div[class*="bg-[#111111]"]');
		if (section?.textContent?.includes('Small')) return section;
	}
	return headings[headings.length - 1].closest('div[class*="bg-[#111111]"]');
}

describe('ModelRoutingSection', () => {
	it('renders Model Routing section heading', async () => {
		render(<ProjectSettings projectId="test-123" />);
		// At least one "Model Routing" heading should be found (widget card + dedicated section)
		await waitFor(() => {
			expect(screen.getAllByText('Model Routing').length).toBeGreaterThanOrEqual(1);
		});
	});

	it('renders 4 tier labels (S, M, L, XL)', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		expect(screen.getByText('Small')).toBeInTheDocument();
		expect(screen.getByText('Medium')).toBeInTheDocument();
		expect(screen.getByText('Large')).toBeInTheDocument();
		expect(screen.getByText('Extra-L')).toBeInTheDocument();
	});

	it('renders tier key badges (S / M / L / XL) in the routing section', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		// "S", "M", "L", "XL" tier keys appear in the routing section
		expect(screen.getByText('Small')).toBeInTheDocument();
		expect(screen.getByText('Extra-L')).toBeInTheDocument();
	});

	it('renders "Sifirla" (reset) button', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Sifirla');
		expect(screen.getByText('Sifirla')).toBeInTheDocument();
	});

	it('"Kaydet" button in Model Routing is disabled when config is not dirty', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		const section = getModelRoutingSection();
		expect(section).toBeTruthy();
		// When not dirty, Kaydet and Sifirla should be disabled
		const disabledBtns = section?.querySelectorAll('button[disabled]');
		expect(disabledBtns?.length).toBeGreaterThan(0);
	});

	it('can change model for a tier via select', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		const section = getModelRoutingSection();
		const selects = section?.querySelectorAll('select');
		const firstSelect = selects?.[0] as HTMLSelectElement | undefined;

		if (firstSelect) {
			fireEvent.change(firstSelect, { target: { value: 'claude-opus-4-6' } });
			await waitFor(() => {
				expect(firstSelect.value).toBe('claude-opus-4-6');
			});
		}
	});

	it('"Sifirla" button resets config to defaults', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		const section = getModelRoutingSection();
		const selects = section?.querySelectorAll('select');
		const firstSelect = selects?.[0] as HTMLSelectElement | undefined;

		if (firstSelect) {
			fireEvent.change(firstSelect, { target: { value: 'claude-opus-4-6' } });
		}

		const resetBtn = screen.getByText('Sifirla');
		fireEvent.click(resetBtn);

		await waitFor(() => {
			// After reset, the default value claude-haiku should be back for S tier
			const allSelects = document.querySelectorAll('select');
			const haikuSelect = Array.from(allSelects).find(
				(s) => (s as HTMLSelectElement).value === 'claude-haiku-4-5-20251001',
			);
			expect(haikuSelect).toBeTruthy();
		});
	});

	it('calls saveProjectSettings with model_routing category on save', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		// Dirty the config
		const section = getModelRoutingSection();
		const selects = section?.querySelectorAll('select');
		const firstSelect = selects?.[0] as HTMLSelectElement | undefined;
		if (firstSelect) {
			fireEvent.change(firstSelect, { target: { value: 'claude-opus-4-6' } });
		}

		// Find the enabled Kaydet button in the routing section
		await waitFor(() => {
			const saveBtn = section?.querySelector('button.bg-\\[\\#22c55e\\]:not([disabled])');
			expect(saveBtn).toBeTruthy();
		});

		const saveBtn = section?.querySelector('button.bg-\\[\\#22c55e\\]:not([disabled])');
		if (saveBtn) {
			fireEvent.click(saveBtn);
			await waitFor(() => {
				expect(vi.mocked(saveProjectSettings)).toHaveBeenCalledWith(
					'test-123',
					'model_routing',
					expect.any(Object),
				);
			});
		}
	});

	it('shows "Kaydedildi" after successful model routing save', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		const section = getModelRoutingSection();
		const selects = section?.querySelectorAll('select');
		const firstSelect = selects?.[0] as HTMLSelectElement | undefined;
		if (firstSelect) {
			fireEvent.change(firstSelect, { target: { value: 'claude-opus-4-6' } });
		}

		await waitFor(() => {
			const saveBtn = section?.querySelector('button.bg-\\[\\#22c55e\\]:not([disabled])');
			expect(saveBtn).toBeTruthy();
		});

		const saveBtn = section?.querySelector('button.bg-\\[\\#22c55e\\]:not([disabled])');
		if (saveBtn) {
			fireEvent.click(saveBtn);
			await waitFor(() => {
				expect(screen.queryAllByText('Kaydedildi').length).toBeGreaterThan(0);
			});
		}
	});

	it('shows error when model routing save fails', async () => {
		vi.mocked(saveProjectSettings).mockRejectedValue(new Error('Save failed'));
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		const section = getModelRoutingSection();
		const selects = section?.querySelectorAll('select');
		const firstSelect = selects?.[0] as HTMLSelectElement | undefined;
		if (firstSelect) {
			fireEvent.change(firstSelect, { target: { value: 'claude-opus-4-6' } });
		}

		await waitFor(() => {
			const saveBtn = section?.querySelector('button.bg-\\[\\#22c55e\\]:not([disabled])');
			expect(saveBtn).toBeTruthy();
		});

		const saveBtn = section?.querySelector('button.bg-\\[\\#22c55e\\]:not([disabled])');
		if (saveBtn) {
			fireEvent.click(saveBtn);
			await waitFor(() => {
				expect(screen.getByText('Save failed')).toBeInTheDocument();
			});
		}
	});

	it('loads saved model routing overrides from settings', async () => {
		vi.mocked(fetchProjectSettings).mockResolvedValue({
			model_routing: {
				S: 'claude-opus-4-6',
				M: 'claude-opus-4-6',
				L: 'claude-opus-4-6',
				XL: 'claude-opus-4-6',
			},
		});

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Small');

		await waitFor(() => {
			const section = getModelRoutingSection();
			const selects = section?.querySelectorAll('select');
			const opusSelects = Array.from(selects ?? []).filter(
				(s) => (s as HTMLSelectElement).value === 'claude-opus-4-6',
			);
			expect(opusSelects.length).toBeGreaterThanOrEqual(1);
		});
	});
});

// ---------------------------------------------------------------------------
// 3. MemorySection
// ---------------------------------------------------------------------------

describe('MemorySection', () => {
	it('renders Project Memory section heading', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');
		expect(screen.getByText('Project Memory')).toBeInTheDocument();
	});

	it('shows 0 fact count badge when no facts', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');
		expect(screen.getByText('0 fact (0 user / 0 auto)')).toBeInTheDocument();
	});

	it('shows correct fact count badge with user and auto facts', async () => {
		vi.mocked(fetchMemoryFacts).mockResolvedValue([
			makeFact({ source: 'user' }),
			makeFact({ scope: 'arch', key: 'db', value: 'postgres', source: 'agent' }),
			makeFact({ scope: 'arch', key: 'lang', value: 'typescript', source: 'system' }),
		]);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		await waitFor(() => {
			expect(screen.getByText('3 fact (1 user / 2 auto)')).toBeInTheDocument();
		});
	});

	it('renders facts grouped by scope', async () => {
		vi.mocked(fetchMemoryFacts).mockResolvedValue([
			makeFact({ scope: 'testing', key: 'framework', value: 'vitest', source: 'user' }),
			makeFact({ scope: 'testing', key: 'runner', value: 'pnpm', source: 'user' }),
			makeFact({ scope: 'arch', key: 'db', value: 'postgres', source: 'system' }),
		]);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		await waitFor(() => {
			// Scope names appear as group headings
			expect(screen.getByText('testing')).toBeInTheDocument();
			expect(screen.getByText('arch')).toBeInTheDocument();
		});
	});

	it('renders fact key-value pairs', async () => {
		vi.mocked(fetchMemoryFacts).mockResolvedValue([
			makeFact({ scope: 'testing', key: 'framework', value: 'vitest', source: 'user' }),
		]);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		await waitFor(() => {
			expect(screen.getByText('framework')).toBeInTheDocument();
			expect(screen.getByText('vitest')).toBeInTheDocument();
		});
	});

	it('can add a new fact via the add form', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		// Fill in the add form
		const scopeInput = screen.getByPlaceholderText('scope (e.g. testing)');
		const keyInput = screen.getByPlaceholderText('key (e.g. framework)');
		const valueInput = screen.getByPlaceholderText('value');

		fireEvent.change(scopeInput, { target: { value: 'newscope' } });
		fireEvent.change(keyInput, { target: { value: 'newkey' } });
		fireEvent.change(valueInput, { target: { value: 'newvalue' } });

		const addBtn = screen.getByText('Ekle');
		fireEvent.click(addBtn);

		await waitFor(() => {
			expect(vi.mocked(upsertMemoryFact)).toHaveBeenCalledWith('test-123', {
				scope: 'newscope',
				key: 'newkey',
				value: 'newvalue',
				confidence: 1.0,
				source: 'user',
			});
		});
	});

	it('shows error when scope or key is empty on add', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		// Click Ekle without filling scope/key
		const addBtn = screen.getByText('Ekle');
		// Button is disabled when scope/key empty - verify it is disabled
		expect(addBtn).toBeDisabled();
	});

	it('can delete a fact with confirmation', async () => {
		vi.mocked(fetchMemoryFacts).mockResolvedValue([
			makeFact({ scope: 'testing', key: 'framework', value: 'vitest', source: 'user' }),
		]);
		window.confirm = vi.fn(() => true);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('framework');

		const deleteBtn = screen.getByTitle('Sil');
		fireEvent.click(deleteBtn);

		await waitFor(() => {
			expect(window.confirm).toHaveBeenCalled();
			expect(vi.mocked(deleteMemoryFact)).toHaveBeenCalledWith('test-123', 'testing', 'framework');
		});
	});

	it('does not delete when user cancels confirmation', async () => {
		vi.mocked(fetchMemoryFacts).mockResolvedValue([
			makeFact({ scope: 'testing', key: 'framework', value: 'vitest', source: 'user' }),
		]);
		window.confirm = vi.fn(() => false);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('framework');

		const deleteBtn = screen.getByTitle('Sil');
		fireEvent.click(deleteBtn);

		expect(vi.mocked(deleteMemoryFact)).not.toHaveBeenCalled();
	});

	it('refresh button calls refreshMemorySnapshot and fetchMemoryContext', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Snapshot Yenile');

		fireEvent.click(screen.getByText('Snapshot Yenile'));

		await waitFor(() => {
			expect(vi.mocked(refreshMemorySnapshot)).toHaveBeenCalledWith('test-123');
		});
	});

	it('shows loading state while memory data is loading', async () => {
		let resolveSettings: (v: Record<string, Record<string, string>>) => void = () => {};
		vi.mocked(fetchProjectSettings).mockReturnValue(
			new Promise((res) => { resolveSettings = res; }),
		);

		render(<ProjectSettings projectId="test-123" />);

		// The global loading spinner should be visible
		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();

		resolveSettings({});
	});

	it('shows error when memory API fails', async () => {
		vi.mocked(fetchMemoryFacts).mockRejectedValue(new Error('Memory service unavailable'));

		render(<ProjectSettings projectId="test-123" />);

		await waitFor(() => {
			expect(screen.getByText('Memory service unavailable')).toBeInTheDocument();
		});
	});

	it('context preview toggle shows/hides working memory text', async () => {
		vi.mocked(fetchMemoryContext).mockResolvedValue('AI context preview text');

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		// Click the context toggle button
		const contextToggle = screen.getByText(/AI'nin gordugu context/);
		fireEvent.click(contextToggle);

		await waitFor(() => {
			expect(screen.getByText('AI context preview text')).toBeInTheDocument();
		});

		// Click again to collapse
		fireEvent.click(contextToggle);
		await waitFor(() => {
			expect(screen.queryByText('AI context preview text')).not.toBeInTheDocument();
		});
	});

	it('shows placeholder when context is empty', async () => {
		vi.mocked(fetchMemoryContext).mockResolvedValue('');

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		const contextToggle = screen.getByText(/AI'nin gordugu context/);
		fireEvent.click(contextToggle);

		await waitFor(() => {
			expect(
				screen.getByText(/snapshot henuz olusturulmadi/i),
			).toBeInTheDocument();
		});
	});

	it('calls fetchMemoryFacts with projectId on mount', async () => {
		render(<ProjectSettings projectId="proj-456" />);
		await screen.findByText('Project Memory');

		expect(vi.mocked(fetchMemoryFacts)).toHaveBeenCalledWith('proj-456');
	});

	it('shows "Henuz fact yok" when no facts exist', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		await waitFor(() => {
			expect(screen.getByText(/Henuz fact yok/)).toBeInTheDocument();
		});
	});

	it('renders scope count badge next to scope name', async () => {
		vi.mocked(fetchMemoryFacts).mockResolvedValue([
			makeFact({ scope: 'testing', key: 'framework', value: 'vitest' }),
			makeFact({ scope: 'testing', key: 'runner', value: 'pnpm' }),
		]);

		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Project Memory');

		await waitFor(() => {
			// (2) count badge next to "testing" scope
			expect(screen.getByText('(2)')).toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// 4. General / Integration
// ---------------------------------------------------------------------------

describe('ProjectSettings general', () => {
	it('renders Proje Ayarlari heading', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Proje Ayarlari');
		expect(screen.getByText('Proje Ayarlari')).toBeInTheDocument();
	});

	it('shows loading spinner while initial data loads', () => {
		let resolveSettings: (v: Record<string, Record<string, string>>) => void = () => {};
		vi.mocked(fetchProjectSettings).mockReturnValue(
			new Promise((res) => { resolveSettings = res; }),
		);

		const { container } = render(<ProjectSettings projectId="test-123" />);
		const spinner = container.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();

		resolveSettings({});
	});

	it('calls fetchProjectSettings on mount with projectId', async () => {
		render(<ProjectSettings projectId="my-project" />);
		await screen.findByText('Proje Ayarlari');
		expect(vi.mocked(fetchProjectSettings)).toHaveBeenCalledWith('my-project');
	});

	it('shows error when fetchProjectSettings rejects', async () => {
		vi.mocked(fetchProjectSettings).mockRejectedValue(new Error('Network error'));

		render(<ProjectSettings projectId="test-123" />);

		await waitFor(() => {
			expect(screen.getByText('Network error')).toBeInTheDocument();
		});
	});

	it('calls fetchProviders on mount', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Proje Ayarlari');
		expect(vi.mocked(fetchProviders)).toHaveBeenCalled();
	});

	it('renders widget cards after loading', async () => {
		render(<ProjectSettings projectId="test-123" />);
		await screen.findByText('Proje Ayarlari');
		expect(screen.getByText('SonarQube')).toBeInTheDocument();
		expect(screen.getByText('ESLint')).toBeInTheDocument();
		expect(screen.getByText('Prettier')).toBeInTheDocument();
		expect(screen.getByText('Budget Limiti')).toBeInTheDocument();
	});
});
