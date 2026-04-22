import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectTemplate } from '../lib/studio-api/templates.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchTemplates = vi.fn<() => Promise<ProjectTemplate[]>>();
const mockUseTemplate = vi.fn<() => Promise<ProjectTemplate>>();
const mockNavigate = vi.fn();

vi.mock('../lib/studio-api/templates.js', () => ({
	fetchTemplates: (...args: unknown[]) => mockFetchTemplates(...(args as [])),
	useTemplate: (...args: unknown[]) => mockUseTemplate(...(args as [])),
}));

vi.mock('react-router-dom', () => ({
	useNavigate: () => mockNavigate,
}));

import TemplateGallery from '../pages/studio/TemplateGallery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(overrides: Partial<ProjectTemplate> = {}): ProjectTemplate {
	return {
		id: 'tpl-1',
		name: 'React SPA',
		description: 'A single-page React application',
		category: 'frontend',
		techStack: ['React', 'TypeScript', 'Vite'],
		agentConfig: {},
		phases: [],
		isPublic: true,
		authorId: null,
		usageCount: 42,
		rating: 4.5,
		createdAt: '2026-04-20T00:00:00Z',
		updatedAt: '2026-04-20T00:00:00Z',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateGallery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchTemplates.mockResolvedValue([]);
		mockUseTemplate.mockResolvedValue(makeTemplate());
	});

	it('renders page heading', async () => {
		render(<TemplateGallery />);
		expect(screen.getByText('Template Gallery')).toBeInTheDocument();
	});

	it('shows loading state initially', () => {
		// Keep fetch pending
		mockFetchTemplates.mockReturnValue(new Promise(() => {}));
		render(<TemplateGallery />);
		expect(screen.getByText('Loading templates...')).toBeInTheDocument();
	});

	it('renders template cards after loading', async () => {
		mockFetchTemplates.mockResolvedValue([
			makeTemplate({ id: 'tpl-1', name: 'React SPA' }),
			makeTemplate({ id: 'tpl-2', name: 'Node API', category: 'backend' }),
		]);

		render(<TemplateGallery />);

		await waitFor(() => {
			expect(screen.getByText('React SPA')).toBeInTheDocument();
			expect(screen.getByText('Node API')).toBeInTheDocument();
		});
	});

	it('renders tech stack badges on cards', async () => {
		mockFetchTemplates.mockResolvedValue([
			makeTemplate({ techStack: ['React', 'TypeScript', 'Vite'] }),
		]);

		render(<TemplateGallery />);

		await waitFor(() => {
			expect(screen.getByText('React')).toBeInTheDocument();
			expect(screen.getByText('TypeScript')).toBeInTheDocument();
			expect(screen.getByText('Vite')).toBeInTheDocument();
		});
	});

	it('shows empty state when no templates exist', async () => {
		mockFetchTemplates.mockResolvedValue([]);

		render(<TemplateGallery />);

		await waitFor(() => {
			expect(screen.getByText(/No templates yet/i)).toBeInTheDocument();
		});
	});

	it('shows empty state with clear filters option when filters are active', async () => {
		const user = userEvent.setup();
		mockFetchTemplates.mockResolvedValue([]);

		render(<TemplateGallery />);

		// Type in search
		const searchInput = screen.getByPlaceholderText('Search templates...');
		await user.type(searchInput, 'nonexistent');

		await waitFor(() => {
			expect(screen.getByText(/No templates match your filters/i)).toBeInTheDocument();
		});
	});

	it('category filter tabs render correctly', async () => {
		render(<TemplateGallery />);

		// All category buttons should be present
		expect(screen.getByRole('button', { name: /Filter by All/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Filter by Frontend/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Filter by Backend/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Filter by Fullstack/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Filter by Mobile/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Filter by API/i })).toBeInTheDocument();
	});

	it('clicking a category filter calls fetchTemplates with category param', async () => {
		const user = userEvent.setup();
		mockFetchTemplates.mockResolvedValue([]);

		render(<TemplateGallery />);

		await user.click(screen.getByRole('button', { name: /Filter by Frontend/i }));

		await waitFor(() => {
			// fetchTemplates should have been called with category: 'frontend'
			const calls = mockFetchTemplates.mock.calls as unknown as Array<[{ category?: string } | undefined]>;
			const lastCall = calls[calls.length - 1]?.[0];
			expect(lastCall?.category).toBe('frontend');
		});
	});

	it('search input triggers re-fetch with search param', async () => {
		const user = userEvent.setup();
		mockFetchTemplates.mockResolvedValue([]);

		render(<TemplateGallery />);

		// Wait for initial load
		await waitFor(() => expect(mockFetchTemplates).toHaveBeenCalled());

		const searchInput = screen.getByPlaceholderText('Search templates...');
		await user.type(searchInput, 'react');

		// Debounce 300ms
		await waitFor(
			() => {
				const calls = mockFetchTemplates.mock.calls as unknown as Array<[{ search?: string } | undefined]>;
				const searchCalls = calls.filter((call) => call[0]?.search === 'react');
				expect(searchCalls.length).toBeGreaterThan(0);
			},
			{ timeout: 1000 },
		);
	});

	it('use template button calls useTemplate and navigates', async () => {
		const user = userEvent.setup();
		const template = makeTemplate({ id: 'tpl-abc', name: 'Express API' });
		mockFetchTemplates.mockResolvedValue([template]);
		mockUseTemplate.mockResolvedValue({ ...template, usageCount: 43 });

		render(<TemplateGallery />);

		await waitFor(() => screen.getByText('Express API'));

		const useBtn = screen.getByRole('button', { name: /Use template Express API/i });
		await user.click(useBtn);

		await waitFor(() => {
			expect(mockUseTemplate).toHaveBeenCalledWith('tpl-abc');
			expect(mockNavigate).toHaveBeenCalledWith(
				'/studio/new',
				expect.objectContaining({
					state: expect.objectContaining({
						template: expect.objectContaining({ templateId: 'tpl-abc' }),
					}),
				}),
			);
		});
	});

	it('shows template count summary', async () => {
		mockFetchTemplates.mockResolvedValue([
			makeTemplate({ id: 'tpl-1' }),
			makeTemplate({ id: 'tpl-2' }),
			makeTemplate({ id: 'tpl-3' }),
		]);

		render(<TemplateGallery />);

		await waitFor(() => {
			expect(screen.getByText(/3 templates found/i)).toBeInTheDocument();
		});
	});

	it('shows error state and retry button on fetch failure', async () => {
		const user = userEvent.setup();
		mockFetchTemplates.mockRejectedValue(new Error('Network error'));

		render(<TemplateGallery />);

		await waitFor(() => {
			expect(screen.getByText('Network error')).toBeInTheDocument();
		});

		const retryBtn = screen.getByRole('button', { name: /retry/i });
		expect(retryBtn).toBeInTheDocument();

		// Retry success
		mockFetchTemplates.mockResolvedValue([makeTemplate()]);
		await user.click(retryBtn);

		await waitFor(() => {
			expect(screen.getByText('React SPA')).toBeInTheDocument();
		});
	});

	it('New Template button navigates to creation route', async () => {
		const user = userEvent.setup();
		render(<TemplateGallery />);

		const newBtn = screen.getByRole('button', { name: /New Template/i });
		await user.click(newBtn);

		expect(mockNavigate).toHaveBeenCalledWith('/studio/templates/new');
	});

	it('renders usage count and rating on cards', async () => {
		mockFetchTemplates.mockResolvedValue([
			makeTemplate({ usageCount: 100, rating: 3.5 }),
		]);

		render(<TemplateGallery />);

		await waitFor(() => {
			// Usage count
			expect(screen.getByText('100')).toBeInTheDocument();
			// Rating
			expect(screen.getByText('3.5')).toBeInTheDocument();
		});
	});

	it('shows +N badge when tech stack exceeds 4 items', async () => {
		mockFetchTemplates.mockResolvedValue([
			makeTemplate({ techStack: ['React', 'TypeScript', 'Vite', 'Tailwind', 'Zustand', 'React Router'] }),
		]);

		render(<TemplateGallery />);

		await waitFor(() => {
			expect(screen.getByText('+2 more')).toBeInTheDocument();
		});
	});
});
