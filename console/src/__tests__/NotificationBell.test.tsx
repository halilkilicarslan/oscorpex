import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from '../components/NotificationBell';
import type { AppNotification } from '../lib/studio-api';

// ---------------------------------------------------------------------------
// Mock studio-api
// ---------------------------------------------------------------------------

const mockFetchNotifications = vi.fn<() => Promise<AppNotification[]>>();
const mockFetchUnreadCount = vi.fn<() => Promise<number>>();
const mockMarkRead = vi.fn<() => Promise<void>>();
const mockMarkAllRead = vi.fn<() => Promise<void>>();
const mockDeleteNotification = vi.fn<() => Promise<void>>();

vi.mock('../lib/studio-api', () => ({
	fetchNotifications: (...args: unknown[]) => mockFetchNotifications(...(args as [])),
	fetchUnreadNotificationCount: (...args: unknown[]) => mockFetchUnreadCount(...(args as [])),
	markNotificationRead: (...args: unknown[]) => mockMarkRead(...(args as [])),
	markAllNotificationsRead: (...args: unknown[]) => mockMarkAllRead(...(args as [])),
	deleteNotification: (...args: unknown[]) => mockDeleteNotification(...(args as [])),
}));

// Mock useWsEventRefresh (no-op)
vi.mock('../hooks/useWsEventRefresh', () => ({
	useWsEventRefresh: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
	return {
		id: 'notif-1',
		tenantId: null,
		userId: null,
		projectId: 'proj-1',
		type: 'task_completed',
		title: 'Task completed: Build UI',
		body: 'Agent finished task successfully.',
		read: false,
		data: {},
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationBell', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFetchUnreadCount.mockResolvedValue(0);
		mockFetchNotifications.mockResolvedValue([]);
		mockMarkRead.mockResolvedValue(undefined);
		mockMarkAllRead.mockResolvedValue(undefined);
		mockDeleteNotification.mockResolvedValue(undefined);
	});

	it('bell ikonu render edilmeli', async () => {
		render(<NotificationBell />);
		expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
	});

	it('okunmamis mesaj yoksa rozet gosterilmemeli', async () => {
		mockFetchUnreadCount.mockResolvedValue(0);
		render(<NotificationBell />);

		await waitFor(() => {
			expect(screen.queryByLabelText(/unread notifications/)).not.toBeInTheDocument();
		});
	});

	it('okunmamis mesaj varsa rozet gosterilmeli', async () => {
		mockFetchUnreadCount.mockResolvedValue(3);
		render(<NotificationBell />);

		await waitFor(() => {
			expect(screen.getByLabelText('3 unread notifications')).toBeInTheDocument();
		});
	});

	it('99+ gosterimi 100 okunmamis icin', async () => {
		mockFetchUnreadCount.mockResolvedValue(100);
		render(<NotificationBell />);

		await waitFor(() => {
			expect(screen.getByText('99+')).toBeInTheDocument();
		});
	});

	it('tiklaninca dropdown paneli acilmali', async () => {
		const user = userEvent.setup();
		const notif = makeNotification();
		mockFetchNotifications.mockResolvedValue([notif]);

		render(<NotificationBell />);

		await user.click(screen.getByLabelText('Notifications'));

		await waitFor(() => {
			expect(screen.getByText('Task completed: Build UI')).toBeInTheDocument();
		});
	});

	it('bos durum mesaji gosterilmeli', async () => {
		const user = userEvent.setup();
		mockFetchNotifications.mockResolvedValue([]);

		render(<NotificationBell />);

		await user.click(screen.getByLabelText('Notifications'));

		await waitFor(() => {
			expect(screen.getByText('No notifications yet')).toBeInTheDocument();
		});
	});

	it('mark as read butonu tiklaninca okundu yapilmali', async () => {
		const user = userEvent.setup();
		mockFetchUnreadCount.mockResolvedValue(1);
		mockFetchNotifications.mockResolvedValue([makeNotification({ id: 'n-1', read: false })]);

		render(<NotificationBell />);

		await user.click(screen.getByLabelText('Notifications'));

		await waitFor(() => screen.getByTitle('Mark as read'));
		await user.click(screen.getByTitle('Mark as read'));

		expect(mockMarkRead).toHaveBeenCalledWith('n-1');
	});

	it('delete butonu tiklaninca silinmeli', async () => {
		const user = userEvent.setup();
		mockFetchNotifications.mockResolvedValue([makeNotification({ id: 'n-2' })]);

		render(<NotificationBell />);

		await user.click(screen.getByLabelText('Notifications'));

		await waitFor(() => screen.getByTitle('Delete'));
		await user.click(screen.getByTitle('Delete'));

		expect(mockDeleteNotification).toHaveBeenCalledWith('n-2');
	});

	it('mark all read butonu tiklaninca hepsi okundu yapilmali', async () => {
		const user = userEvent.setup();
		mockFetchUnreadCount.mockResolvedValue(2);
		mockFetchNotifications.mockResolvedValue([
			makeNotification({ id: 'n-1', read: false }),
			makeNotification({ id: 'n-2', read: false }),
		]);

		render(<NotificationBell />);

		await user.click(screen.getByLabelText('Notifications'));

		await waitFor(() => screen.getByText('All read'));
		await user.click(screen.getByText('All read'));

		expect(mockMarkAllRead).toHaveBeenCalled();
	});

	it('notification body gosterilmeli', async () => {
		const user = userEvent.setup();
		mockFetchNotifications.mockResolvedValue([
			makeNotification({ body: 'Agent finished task successfully.' }),
		]);

		render(<NotificationBell />);

		await user.click(screen.getByLabelText('Notifications'));

		await waitFor(() => {
			expect(screen.getByText('Agent finished task successfully.')).toBeInTheDocument();
		});
	});
});
