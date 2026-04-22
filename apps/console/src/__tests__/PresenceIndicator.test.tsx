import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresenceIndicator } from '../components/PresenceIndicator';
import type { UserPresence } from '../lib/studio-api/collaboration';

// ---------------------------------------------------------------------------
// Mock studio-api collaboration
// ---------------------------------------------------------------------------

const mockFetchPresence = vi.fn<() => Promise<UserPresence[]>>();

vi.mock('../lib/studio-api/collaboration.js', () => ({
	fetchPresence: (...args: unknown[]) => mockFetchPresence(...(args as [])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<UserPresence> = {}): UserPresence {
	return {
		userId: 'user-1',
		displayName: 'Alice',
		projectId: 'proj-1',
		activeTab: 'kanban',
		lastSeen: Date.now(),
		color: '#22c55e',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PresenceIndicator', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchPresence.mockResolvedValue([]);
	});

	// -------------------------------------------------------------------------
	// Empty state
	// -------------------------------------------------------------------------

	it('renders empty state when no users are present', async () => {
		mockFetchPresence.mockResolvedValue([]);
		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('No active users')).toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Avatar circles
	// -------------------------------------------------------------------------

	it('renders avatar circles for each user', async () => {
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice', color: '#22c55e' }),
			makeUser({ userId: 'user-2', displayName: 'Bob', color: '#3b82f6' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => {
			// First letter of each name should appear as avatar initial
			expect(screen.getByLabelText('Alice')).toBeInTheDocument();
			expect(screen.getByLabelText('Bob')).toBeInTheDocument();
		});
	});

	it('renders correct initials in avatar circles', async () => {
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('A')).toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Color application
	// -------------------------------------------------------------------------

	it('applies correct border color from presence data', async () => {
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice', color: '#ff0000' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => {
			const avatar = screen.getByLabelText('Alice');
			// Border color should contain the assigned color
			expect(avatar).toHaveStyle({ border: '2px solid #ff0000' });
		});
	});

	// -------------------------------------------------------------------------
	// Overflow "+N more"
	// -------------------------------------------------------------------------

	it('shows "+N more" badge when users exceed maxVisible', async () => {
		const users = Array.from({ length: 8 }, (_, i) =>
			makeUser({ userId: `user-${i}`, displayName: `User ${i}` }),
		);
		mockFetchPresence.mockResolvedValue(users);

		render(<PresenceIndicator projectId="proj-1" maxVisible={5} />);

		await waitFor(() => {
			// 8 users, maxVisible=5 → +3 more
			expect(screen.getByText('+3')).toBeInTheDocument();
		});
	});

	it('does not show overflow badge when users are within maxVisible limit', async () => {
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice' }),
			makeUser({ userId: 'user-2', displayName: 'Bob' }),
		]);

		render(<PresenceIndicator projectId="proj-1" maxVisible={5} />);

		await waitFor(() => {
			expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Tooltip
	// -------------------------------------------------------------------------

	it('shows displayName in tooltip on hover', async () => {
		const user = userEvent.setup();
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice', activeTab: 'kanban' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => screen.getByLabelText('Alice'));

		await user.hover(screen.getByLabelText('Alice'));

		await waitFor(() => {
			expect(screen.getByText('Alice')).toBeVisible();
		});
	});

	it('shows active tab in tooltip when present', async () => {
		const user = userEvent.setup();
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice', activeTab: 'Sprint Board' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => screen.getByLabelText('Alice'));

		await user.hover(screen.getByLabelText('Alice'));

		await waitFor(() => {
			expect(screen.getByText('Viewing: Sprint Board')).toBeInTheDocument();
		});
	});

	// -------------------------------------------------------------------------
	// Accessibility
	// -------------------------------------------------------------------------

	it('has aria-label with user count on container', async () => {
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice' }),
			makeUser({ userId: 'user-2', displayName: 'Bob' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByLabelText('2 active users')).toBeInTheDocument();
		});
	});

	it('uses singular label for single user', async () => {
		mockFetchPresence.mockResolvedValue([
			makeUser({ userId: 'user-1', displayName: 'Alice' }),
		]);

		render(<PresenceIndicator projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByLabelText('1 active user')).toBeInTheDocument();
		});
	});
});
