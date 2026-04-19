import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import KanbanBoard from '../pages/studio/KanbanBoard';
import * as studioApi from '../lib/studio-api';
import type { Task } from '../lib/studio-api';

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
	fetchTasksPaginated: vi.fn(),
	retryTask: vi.fn(),
	fetchProjectAgents: vi.fn().mockResolvedValue([]),
	fetchAutoStartStatus: vi.fn().mockResolvedValue({
		projectId: 'test-project',
		planApproved: false,
		autoStartEnabled: true,
		pipeline: null,
	}),
	roleLabel: vi.fn((role: string) => role),
}));

// TaskCard bagimliligi — sadece temel bilgileri goster
vi.mock('../pages/studio/TaskCard', () => ({
	default: ({ task, onRetry }: { task: Task; onRetry?: () => void }) => (
		<div data-testid={`task-card-${task.id}`} data-status={task.status}>
			<span>{task.title}</span>
			<span>{task.assignedAgent}</span>
			{onRetry && (
				<button onClick={onRetry} data-testid={`retry-${task.id}`}>
					Tekrar Dene
				</button>
			)}
		</div>
	),
}));

const ORNEK_GOREVLER: Task[] = [
	{
		id: 'task-1',
		phaseId: 'phase-1',
		title: 'Login sayfasi olustur',
		description: 'JWT kimlik dogrulama ile login formu',
		assignedAgent: 'frontend-dev',
		status: 'queued',
		complexity: 'S',
		dependsOn: [],
		branch: 'feature/login',
		retryCount: 0,
		revisionCount: 0,
		requiresApproval: false,
	},
	{
		id: 'task-2',
		phaseId: 'phase-1',
		title: 'API endpoint yaz',
		description: 'REST API endpointleri',
		assignedAgent: 'backend-dev',
		status: 'running',
		complexity: 'M',
		dependsOn: [],
		branch: 'feature/api',
		retryCount: 0,
		startedAt: '2026-01-15T10:00:00Z',
		revisionCount: 0,
		requiresApproval: false,
	},
	{
		id: 'task-3',
		phaseId: 'phase-2',
		title: 'Veritabani sema',
		description: 'PostgreSQL sema tasarimi',
		assignedAgent: 'backend-dev',
		status: 'done',
		complexity: 'L',
		dependsOn: [],
		branch: 'feature/db',
		retryCount: 0,
		completedAt: '2026-01-14T16:00:00Z',
		output: {
			filesCreated: ['schema.sql'],
			filesModified: [],
			logs: [],
		},
		revisionCount: 0,
		requiresApproval: false,
	},
	{
		id: 'task-4',
		phaseId: 'phase-2',
		title: 'Unit testler yaz',
		description: 'Kritik fonksiyonlar icin birim testler',
		assignedAgent: 'qa-engineer',
		status: 'failed',
		complexity: 'M',
		dependsOn: ['task-3'],
		branch: 'feature/tests',
		retryCount: 2,
		revisionCount: 0,
		requiresApproval: false,
	},
];

/** PaginatedResult sarmalayıcısı */
function paginated(items: Task[], total?: number) {
	return { data: items, total: total ?? items.length, limit: 50, offset: 0 };
}

describe('KanbanBoard — yukleme durumu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('gorevler yuklenirken spinner gosterilmeli', () => {
		// Promise hic cozulmesin
		vi.mocked(studioApi.fetchTasksPaginated).mockReturnValue(new Promise(() => {}));

		render(<KanbanBoard projectId="proj-1" />);

		const spinner = document.querySelector('.animate-spin');
		expect(spinner).toBeTruthy();
	});

	it('gorevler yuklendikten sonra spinner kaybolmali', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Login sayfasi olustur')).toBeInTheDocument();
		});

		expect(document.querySelector('.animate-spin')).toBeFalsy();
	});
});

describe('KanbanBoard — bos durum', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('gorev yoksa bos durum mesaji gosterilmeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated([]));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('No Tasks Yet')).toBeInTheDocument();
		});
	});

	it('bos durumda aciklama metni gosterilmeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated([]));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText(/Tasks will appear here/)).toBeInTheDocument();
		});
	});
});

describe('KanbanBoard — sutun yapisi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('varsayilan sutunlari gostermeli (queued, running, done)', async () => {
		// Bos array icin "No Tasks Yet" gosterilir, bu normal davranis.
		// Sutunlari gormek icin en az bir gorev gerekiyor.
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated([ORNEK_GOREVLER[0]]));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			// Sutun basliklari DOM'da kucuk harfle yer aliyor (CSS uppercase gorsel)
			expect(screen.getByText('Queued')).toBeInTheDocument();
			expect(screen.getByText('Running')).toBeInTheDocument();
			expect(screen.getByText('Done')).toBeInTheDocument();
		});
	});

	it('gorev olan sutunlar gosterilmeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Queued')).toBeInTheDocument();
			expect(screen.getByText('Running')).toBeInTheDocument();
			expect(screen.getByText('Done')).toBeInTheDocument();
			expect(screen.getByText('Failed')).toBeInTheDocument();
		});
	});

	it('gorev olmayan assigned ve review sutunlari gizlenmeli', async () => {
		// Sadece queued, running, done, failed gorevler var
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByText('ASSIGNED')).not.toBeInTheDocument();
			expect(screen.queryByText('REVIEW')).not.toBeInTheDocument();
		});
	});
});

describe('KanbanBoard — gorev kartlari', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('gorev basliklarini gostermeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByText('Login sayfasi olustur')).toBeInTheDocument();
			expect(screen.getByText('API endpoint yaz')).toBeInTheDocument();
			expect(screen.getByText('Veritabani sema')).toBeInTheDocument();
			expect(screen.getByText('Unit testler yaz')).toBeInTheDocument();
		});
	});

	it('gorevler dogru sutunlarda olmali', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			const queuedTask = screen.getByTestId('task-card-task-1');
			const runningTask = screen.getByTestId('task-card-task-2');
			const doneTask = screen.getByTestId('task-card-task-3');
			const failedTask = screen.getByTestId('task-card-task-4');

			expect(queuedTask).toHaveAttribute('data-status', 'queued');
			expect(runningTask).toHaveAttribute('data-status', 'running');
			expect(doneTask).toHaveAttribute('data-status', 'done');
			expect(failedTask).toHaveAttribute('data-status', 'failed');
		});
	});

	it('sutun gorev sayaclarini dogru gostermeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			// Her sutunun badge'ini bul — sutun sayaclarini ara
			const badges = screen.getAllByText('1');
			// queued: 1, running: 1, done: 1, failed: 1 = toplam 4 adet "1" badge
			expect(badges.length).toBeGreaterThanOrEqual(4);
		});
	});

	it('failed gorev icin "Tekrar Dene" butonu gosterilmeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));
		vi.mocked(studioApi.retryTask).mockResolvedValue(undefined);

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.getByTestId('retry-task-4')).toBeInTheDocument();
		});
	});

	it('failed olmayan gorev icin "Tekrar Dene" butonu gosterilmemeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => {
			expect(screen.queryByTestId('retry-task-1')).not.toBeInTheDocument();
			expect(screen.queryByTestId('retry-task-2')).not.toBeInTheDocument();
			expect(screen.queryByTestId('retry-task-3')).not.toBeInTheDocument();
		});
	});
});

describe('KanbanBoard — retry islemi', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('"Tekrar Dene" butonuna tiklaninca retryTask API cagrisi yapilmali', async () => {
		const user = userEvent.setup();
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));
		vi.mocked(studioApi.retryTask).mockResolvedValue(undefined);

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => screen.getByTestId('retry-task-4'));

		await user.click(screen.getByTestId('retry-task-4'));

		await waitFor(() => {
			expect(studioApi.retryTask).toHaveBeenCalledWith('proj-1', 'task-4');
		});
	});

	it('retry sonrasi gorevler yeniden yuklenmeli', async () => {
		const user = userEvent.setup();
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));
		vi.mocked(studioApi.retryTask).mockResolvedValue(undefined);

		render(<KanbanBoard projectId="proj-1" />);

		await waitFor(() => screen.getByTestId('retry-task-4'));

		await user.click(screen.getByTestId('retry-task-4'));

		await waitFor(() => {
			// fetchTasksPaginated en az 2 kez cagrilmali: ilk yukleme + retry sonrasi
			expect(studioApi.fetchTasksPaginated).toHaveBeenCalledTimes(2);
		});
	});
});

describe('KanbanBoard — periyodik guncelleme', () => {
	// Bu describe blogu icin fake timer kullan
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('15 saniyede bir gorevler yeniden yuklenmeli', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated(ORNEK_GOREVLER));

		render(<KanbanBoard projectId="proj-1" />);

		// Ilk cagriyi bekle
		await act(async () => {
			await Promise.resolve();
		});

		expect(studioApi.fetchTasksPaginated).toHaveBeenCalledTimes(1);

		// 15 saniye ilerlet
		await act(async () => {
			vi.advanceTimersByTime(15000);
			await Promise.resolve();
		});

		expect(studioApi.fetchTasksPaginated).toHaveBeenCalledTimes(2);

		// Bir 15 saniye daha ilerlet
		await act(async () => {
			vi.advanceTimersByTime(15000);
			await Promise.resolve();
		});

		expect(studioApi.fetchTasksPaginated).toHaveBeenCalledTimes(3);
	});

	it('projectId degisince yeni ID ile fetchTasksPaginated cagrilmali', async () => {
		vi.mocked(studioApi.fetchTasksPaginated).mockResolvedValue(paginated([]));

		const { rerender } = render(<KanbanBoard projectId="proj-1" />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(studioApi.fetchTasksPaginated).toHaveBeenCalledWith('proj-1', 50, 0);

		rerender(<KanbanBoard projectId="proj-2" />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(studioApi.fetchTasksPaginated).toHaveBeenCalledWith('proj-2', 50, 0);
	});
});
