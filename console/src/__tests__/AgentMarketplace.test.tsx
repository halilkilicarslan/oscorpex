import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MarketplaceItem } from '../lib/studio-api/marketplace.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchMarketplaceItems = vi.fn<() => Promise<MarketplaceItem[]>>();
const mockDownloadMarketplaceItem = vi.fn<() => Promise<{ ok: boolean; config: Record<string, unknown>; item: MarketplaceItem }>>();
const mockRateMarketplaceItem = vi.fn<() => Promise<{ ok: boolean; rating: number; ratingCount: number }>>();

vi.mock('../lib/studio-api/marketplace.js', () => ({
	fetchMarketplaceItems: (...args: unknown[]) => mockFetchMarketplaceItems(...(args as [])),
	downloadMarketplaceItem: (...args: unknown[]) => mockDownloadMarketplaceItem(...(args as [])),
	rateMarketplaceItem: (...args: unknown[]) => mockRateMarketplaceItem(...(args as [])),
}));

import AgentMarketplace from '../pages/studio/AgentMarketplace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
	return {
		id: 'item-1',
		type: 'agent',
		name: 'Super Code Agent',
		description: 'An agent that writes clean code',
		author: 'alice',
		authorId: 'user-alice',
		category: 'backend',
		tags: ['typescript', 'api'],
		config: { model: 'claude-sonnet' },
		downloads: 42,
		rating: 4.5,
		ratingCount: 10,
		isVerified: true,
		createdAt: '2026-04-20T00:00:00Z',
		updatedAt: '2026-04-20T00:00:00Z',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentMarketplace', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchMarketplaceItems.mockResolvedValue([]);
		mockDownloadMarketplaceItem.mockResolvedValue({
			ok: true,
			config: {},
			item: makeItem(),
		});
		mockRateMarketplaceItem.mockResolvedValue({ ok: true, rating: 4.6, ratingCount: 11 });
	});

	it('renders page heading and description', async () => {
		render(<AgentMarketplace />);
		expect(screen.getByText('Agent Marketplace')).toBeInTheDocument();
		expect(screen.getByText(/Discover and install/i)).toBeInTheDocument();
	});

	it('shows loading state initially', () => {
		mockFetchMarketplaceItems.mockReturnValue(new Promise(() => {}));
		render(<AgentMarketplace />);
		expect(screen.getByTestId('loading-state')).toBeInTheDocument();
		expect(screen.getByText('Loading marketplace...')).toBeInTheDocument();
	});

	it('renders marketplace cards after loading', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([
			makeItem({ id: 'item-1', name: 'Super Code Agent' }),
			makeItem({ id: 'item-2', name: 'Template Wizard', type: 'template' }),
		]);

		render(<AgentMarketplace />);

		await waitFor(() => {
			expect(screen.getByText('Super Code Agent')).toBeInTheDocument();
			expect(screen.getByText('Template Wizard')).toBeInTheDocument();
		});

		const cards = screen.getAllByTestId('marketplace-card');
		expect(cards).toHaveLength(2);
	});

	it('shows empty state when no items found', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([]);

		render(<AgentMarketplace />);

		await waitFor(() => {
			expect(screen.getByTestId('empty-state')).toBeInTheDocument();
			expect(screen.getByText('No marketplace items found')).toBeInTheDocument();
		});
	});

	it('type filter tabs render and are clickable', async () => {
		render(<AgentMarketplace />);

		const allTab = screen.getByTestId('type-tab-all');
		const agentsTab = screen.getByTestId('type-tab-agents');
		const templatesTab = screen.getByTestId('type-tab-templates');

		expect(allTab).toBeInTheDocument();
		expect(agentsTab).toBeInTheDocument();
		expect(templatesTab).toBeInTheDocument();

		await userEvent.click(agentsTab);

		await waitFor(() => {
			expect(mockFetchMarketplaceItems).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'agent' }),
			);
		});
	});

	it('search input filters results', async () => {
		render(<AgentMarketplace />);

		const searchInput = screen.getByTestId('search-input');
		await userEvent.type(searchInput, 'code');

		await waitFor(
			() => {
				expect(mockFetchMarketplaceItems).toHaveBeenCalledWith(
					expect.objectContaining({ search: 'code' }),
				);
			},
			{ timeout: 1000 },
		);
	});

	it('sort dropdown changes sort order', async () => {
		render(<AgentMarketplace />);

		await waitFor(() => expect(mockFetchMarketplaceItems).toHaveBeenCalled());

		const sortDropdown = screen.getByTestId('sort-dropdown');
		fireEvent.change(sortDropdown, { target: { value: 'rating' } });

		await waitFor(() => {
			expect(mockFetchMarketplaceItems).toHaveBeenCalledWith(
				expect.objectContaining({ sort: 'rating' }),
			);
		});
	});

	it('install button calls downloadMarketplaceItem', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([makeItem()]);

		render(<AgentMarketplace />);

		await waitFor(() => screen.getByTestId('install-button'));

		const installBtn = screen.getByTestId('install-button');
		await userEvent.click(installBtn);

		await waitFor(() => {
			expect(mockDownloadMarketplaceItem).toHaveBeenCalledWith('item-1');
		});
	});

	it('install button shows "Installed" after success', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([makeItem()]);

		render(<AgentMarketplace />);

		await waitFor(() => screen.getByTestId('install-button'));
		await userEvent.click(screen.getByTestId('install-button'));

		await waitFor(() => {
			expect(screen.getByText('Installed')).toBeInTheDocument();
		});
	});

	it('displays star rating for items', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([makeItem({ rating: 4.5, ratingCount: 10 })]);

		render(<AgentMarketplace />);

		await waitFor(() => {
			expect(screen.getByText(/4\.5/)).toBeInTheDocument();
			expect(screen.getByText(/\(10\)/)).toBeInTheDocument();
		});
	});

	it('shows verified badge for verified items', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([makeItem({ isVerified: true })]);

		render(<AgentMarketplace />);

		await waitFor(() => {
			expect(screen.getByText('Verified')).toBeInTheDocument();
		});
	});

	it('shows item count at bottom when items loaded', async () => {
		mockFetchMarketplaceItems.mockResolvedValue([
			makeItem({ id: 'item-1' }),
			makeItem({ id: 'item-2', name: 'Another Agent' }),
		]);

		render(<AgentMarketplace />);

		await waitFor(() => {
			expect(screen.getByText('2 items shown')).toBeInTheDocument();
		});
	});
});
