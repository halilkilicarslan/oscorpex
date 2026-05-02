import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import StudioHomePage from '../pages/studio/StudioHomePage';
import * as studioApi from '../lib/studio-api';
import type { Project, TeamTemplate } from '../lib/studio-api';

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
  fetchProjects: vi.fn(),
  fetchProjectsPaginated: vi.fn(),
  createProject: vi.fn(),
  createProjectFromTemplate: vi.fn(),
  importProject: vi.fn(),
  createCustomTeam: vi.fn(),
  deleteProject: vi.fn(),
  fetchTeamTemplates: vi.fn(),
  fetchCustomTeams: vi.fn(),
  fetchProjectTemplates: vi.fn().mockResolvedValue([]),
  fetchProjectAgents: vi.fn(),
  fetchProjectAnalytics: vi.fn(),
  fetchPresetAgents: vi.fn().mockResolvedValue([]),
  streamTeamArchitectChat: vi.fn().mockReturnValue(() => {}),
  roleLabel: vi.fn((role: string) => role),
  // 5-step wizard API calls
  saveProjectScopeDraft: vi.fn().mockResolvedValue(undefined),
  approveProjectScope: vi.fn().mockResolvedValue(undefined),
  recommendProjectTeam: vi.fn().mockResolvedValue({ decision: 'auto', reasoning: 'test' }),
  applyProjectTeam: vi.fn().mockResolvedValue(undefined),
}));

// window.confirm'i mockla
vi.stubGlobal('confirm', vi.fn(() => true));

const ORNEK_PROJELER: Project[] = [
  {
    id: 'proj-1',
    name: 'E-Ticaret Uygulamasi',
    description: 'Online magaza projesi',
    status: 'planning',
    techStack: ['React', 'Node.js', 'PostgreSQL'],
    repoPath: '/repos/eticaret',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'proj-2',
    name: 'Dashboard Sistemi',
    description: 'Analitik panosu',
    status: 'running',
    techStack: ['Vue', 'Python'],
    repoPath: '/repos/dashboard',
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-02-05T12:00:00Z',
  },
];

// Bileşeni MemoryRouter ile render eden yardimci fonksiyon
function renderSayfa() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <StudioHomePage />
    </MemoryRouter>,
  );
}

describe('StudioHomePage — proje listesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([]);
    vi.mocked(studioApi.fetchCustomTeams).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({ totalTasks: 0, completedTasks: 0, inProgressTasks: 0, blockedTasks: 0, totalFailures: 0, totalReviewRejections: 0, tasksPerAgent: [], avgCompletionTimeMs: null, pipelineRunCount: 0, pipelineSuccessRate: 0 });
  });

  it('projeler yuklenirken spinner gosterilmeli', () => {
    // Promise hic cozulmesin — yukleme durumunu test et
    vi.mocked(studioApi.fetchProjectsPaginated).mockReturnValue(new Promise(() => {}));

    renderSayfa();

    // Yukleme animasyonu DOM'da olmali (aria-label ile veya animate-spin ile)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('projeler yuklendikten sonra liste gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: ORNEK_PROJELER, total: ORNEK_PROJELER.length });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('E-Ticaret Uygulamasi')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Sistemi')).toBeInTheDocument();
    });
  });

  it('proje aciklamasi gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: ORNEK_PROJELER, total: ORNEK_PROJELER.length });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Online magaza projesi')).toBeInTheDocument();
    });
  });

  it('tech stack etiketleri gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: ORNEK_PROJELER, total: ORNEK_PROJELER.length });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('Node.js')).toBeInTheDocument();
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    });
  });

  it('planning durumundaki proje "Start Planning" butonu gostermeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [ORNEK_PROJELER[0]], total: 1 });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Start Planning')).toBeInTheDocument();
    });
  });

  it('running durumundaki proje "Open" butonu gostermeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [ORNEK_PROJELER[1]], total: 1 });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
    });
  });
});

describe('StudioHomePage — bos durum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([]);
    vi.mocked(studioApi.fetchCustomTeams).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({ totalTasks: 0, completedTasks: 0, inProgressTasks: 0, blockedTasks: 0, totalFailures: 0, totalReviewRejections: 0, tasksPerAgent: [], avgCompletionTimeMs: null, pipelineRunCount: 0, pipelineSuccessRate: 0 });
  });

  it('proje yoksa bos durum mesaji gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [], total: 0 });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
    });
  });

  it('bos durumda "Create Project" butonu gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [], total: 0 });

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Create Project')).toBeInTheDocument();
    });
  });

  it('API hatasi durumunda bos durum gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockRejectedValue(new Error('API hatasi'));

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
    });
  });
});

describe('StudioHomePage — header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([]);
    vi.mocked(studioApi.fetchCustomTeams).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({ totalTasks: 0, completedTasks: 0, inProgressTasks: 0, blockedTasks: 0, totalFailures: 0, totalReviewRejections: 0, tasksPerAgent: [], avgCompletionTimeMs: null, pipelineRunCount: 0, pipelineSuccessRate: 0 });
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [], total: 0 });
  });

  it('sayfa basligi gosterilmeli', async () => {
    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Oscorpex')).toBeInTheDocument();
    });
  });

  it('"New Project" butonu gosterilmeli', async () => {
    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('New Project')).toBeInTheDocument();
    });
  });
});

describe('StudioHomePage — proje olusturma modali', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([]);
    vi.mocked(studioApi.fetchCustomTeams).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({ totalTasks: 0, completedTasks: 0, inProgressTasks: 0, blockedTasks: 0, totalFailures: 0, totalReviewRejections: 0, tasksPerAgent: [], avgCompletionTimeMs: null, pipelineRunCount: 0, pipelineSuccessRate: 0 });
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [], total: 0 });
  });

  it('"New Project" butonuna tiklaninca modal acilmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));

    await user.click(screen.getByText('New Project'));

    expect(screen.getByText('New Project', { selector: 'h2' })).toBeInTheDocument();
    // Step 1: proje adi inputu olmali (yeni placeholder)
    expect(screen.getByPlaceholderText(/Counter App/)).toBeInTheDocument();
  });

  it('modal "Cancel" butonuna tiklaninca kapanmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));

    await user.click(screen.getByText('New Project'));
    expect(screen.getByPlaceholderText(/Counter App/)).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText(/Counter App/)).not.toBeInTheDocument();
  });

  it('Step 1 "Create Shell" butonu isim girilmeden disabled olmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));
    await user.click(screen.getByText('New Project'));

    const createShellBtn = screen.getByRole('button', { name: 'Create Shell' });
    expect(createShellBtn).toBeDisabled();
  });

  it('isim ve aciklama girildikten sonra "Create Shell" butonu aktif olmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));
    await user.click(screen.getByText('New Project'));

    const nameInput = screen.getByPlaceholderText(/Counter App/);
    await user.type(nameInput, 'Benim Projem');

    // Description da gerekli (min 10 karakter)
    const descInput = screen.getByPlaceholderText(/Describe the product/);
    await user.type(descInput, 'Basit bir todo uygulamasi');

    const createShellBtn = screen.getByRole('button', { name: 'Create Shell' });
    expect(createShellBtn).not.toBeDisabled();
  });

  it('Step 1 "Create Shell" butonuyla createProject API cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    const yeniProje: Project = { ...ORNEK_PROJELER[0], id: 'proj-yeni', name: 'Benim Projem' };
    vi.mocked(studioApi.createProject).mockResolvedValue(yeniProje);
    renderSayfa();

    await waitFor(() => screen.getByRole('heading', { name: 'Oscorpex' }));

    const newProjectBtns = screen.getAllByText('New Project');
    await user.click(newProjectBtns[0]);

    await waitFor(() => screen.getByPlaceholderText(/Counter App/));

    const nameInput = screen.getByPlaceholderText(/Counter App/);
    await user.type(nameInput, 'Benim Projem');

    // Description da gerekli (min 10 karakter)
    const descInput = screen.getByPlaceholderText(/Describe the product/);
    await user.type(descInput, 'Basit bir todo uygulamasi');

    // Step 1: Create Shell butonu ile proje olustur
    await user.click(screen.getByRole('button', { name: 'Create Shell' }));

    await waitFor(() => {
      expect(studioApi.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Benim Projem' }),
      );
    });
  });

  it('Step 1 de isim alaninin placeholder icermesi', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));
    await user.click(screen.getByText('New Project'));

    expect(screen.getByPlaceholderText(/Counter App/)).toBeInTheDocument();
  });
});

describe('StudioHomePage — proje silme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([]);
    vi.mocked(studioApi.fetchCustomTeams).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({ totalTasks: 0, completedTasks: 0, inProgressTasks: 0, blockedTasks: 0, totalFailures: 0, totalReviewRejections: 0, tasksPerAgent: [], avgCompletionTimeMs: null, pipelineRunCount: 0, pipelineSuccessRate: 0 });
    vi.mocked(studioApi.deleteProject).mockResolvedValue(undefined);
  });

  it('onay verilince deleteProject API cagrisi yapilmali', async () => {
    vi.mocked(studioApi.fetchProjectsPaginated).mockResolvedValue({ data: [ORNEK_PROJELER[0]], total: 1 });
    vi.mocked(confirm).mockReturnValue(true);

    renderSayfa();

    await waitFor(() => screen.getByText('E-Ticaret Uygulamasi'));

    // Silme butonunu bulmak icin group hover tetikle — delete butonu gizli
    // Direkt title attribute ile sorgula
    const deleteBtn = screen.getByTitle('Delete project');
    await userEvent.click(deleteBtn);

    await waitFor(() => {
      expect(studioApi.deleteProject).toHaveBeenCalledWith('proj-1');
    });
  });
});
