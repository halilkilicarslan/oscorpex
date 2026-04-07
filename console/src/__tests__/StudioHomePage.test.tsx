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
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchTeamTemplates: vi.fn(),
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
  });

  it('projeler yuklenirken spinner gosterilmeli', () => {
    // Promise hic cozulmesin — yukleme durumunu test et
    vi.mocked(studioApi.fetchProjects).mockReturnValue(new Promise(() => {}));

    renderSayfa();

    // Yukleme animasyonu DOM'da olmali (aria-label ile veya animate-spin ile)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('projeler yuklendikten sonra liste gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue(ORNEK_PROJELER);

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('E-Ticaret Uygulamasi')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Sistemi')).toBeInTheDocument();
    });
  });

  it('proje aciklamasi gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue(ORNEK_PROJELER);

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Online magaza projesi')).toBeInTheDocument();
    });
  });

  it('tech stack etiketleri gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue(ORNEK_PROJELER);

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('Node.js')).toBeInTheDocument();
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    });
  });

  it('planning durumundaki proje "Start Planning" butonu gostermeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([ORNEK_PROJELER[0]]);

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Start Planning')).toBeInTheDocument();
    });
  });

  it('running durumundaki proje "Open" butonu gostermeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([ORNEK_PROJELER[1]]);

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
  });

  it('proje yoksa bos durum mesaji gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([]);

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
    });
  });

  it('bos durumda "Create Project" butonu gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([]);

    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('Create Project')).toBeInTheDocument();
    });
  });

  it('API hatasi durumunda bos durum gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjects).mockRejectedValue(new Error('API hatasi'));

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
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([]);
  });

  it('sayfa basligi gosterilmeli', async () => {
    renderSayfa();

    await waitFor(() => {
      expect(screen.getByText('AI Dev Studio')).toBeInTheDocument();
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
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([]);
  });

  it('"New Project" butonuna tiklaninca modal acilmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));

    await user.click(screen.getByText('New Project'));

    expect(screen.getByText('New Project', { selector: 'h2' })).toBeInTheDocument();
    // Modal icinde proje adi inputu olmali
    expect(screen.getByPlaceholderText('My Awesome App')).toBeInTheDocument();
  });

  it('modal "Cancel" butonuna tiklaninca kapanmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));

    await user.click(screen.getByText('New Project'));
    expect(screen.getByPlaceholderText('My Awesome App')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('My Awesome App')).not.toBeInTheDocument();
  });

  it('"Create Project" butonu isim girilmeden disabled olmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));
    await user.click(screen.getByText('New Project'));

    // Modalin icindeki Create Project butonunu sec (disabled olan)
    const createBtns = screen.getAllByRole('button', { name: 'Create Project' });
    // Modal icindeki buton — disabled olmali (isim girilmedi)
    const modalBtn = createBtns.find((btn) => btn.hasAttribute('disabled'));
    expect(modalBtn).toBeTruthy();
    expect(modalBtn).toBeDisabled();
  });

  it('isim girildikten sonra "Create Project" butonu aktif olmali', async () => {
    const user = userEvent.setup();
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));
    await user.click(screen.getByText('New Project'));

    const nameInput = screen.getByPlaceholderText('My Awesome App');
    await user.type(nameInput, 'Benim Projem');

    // Buton artik disabled olmamali
    const createBtns = screen.getAllByRole('button', { name: 'Create Project' });
    const enabledBtn = createBtns.find((btn) => !btn.hasAttribute('disabled'));
    expect(enabledBtn).toBeTruthy();
    expect(enabledBtn).not.toBeDisabled();
  });

  it('form gonderildiginde createProject API cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    const yeniProje: Project = { ...ORNEK_PROJELER[0], id: 'proj-yeni', name: 'Benim Projem' };
    vi.mocked(studioApi.createProject).mockResolvedValue(yeniProje);
    renderSayfa();

    // Sayfanin yuklendigini bekle
    await waitFor(() => screen.getByRole('heading', { name: 'AI Dev Studio' }));

    // New Project butonuna tikla — header butonunu secmek icin
    const newProjectBtns = screen.getAllByText('New Project');
    await user.click(newProjectBtns[0]);

    // Modal acildiginda isim girilecek inputu bekle
    await waitFor(() => screen.getByPlaceholderText('My Awesome App'));

    const nameInput = screen.getByPlaceholderText('My Awesome App');
    await user.type(nameInput, 'Benim Projem');

    // Modal icindeki son Create Project butonuna tikla
    // Not: React'in disabled prop'u DOM attribute'u olarak atanmis olabilir veya
    // sadece CSS class ile gizlenebilir. Her iki durumu da desteklemek icin
    // modal footer'indaki son butonu hedefliyoruz.
    const modalFooterBtn = screen
      .getByText('Cancel')
      .closest('div')!
      .querySelector('button:last-child')!;
    await user.click(modalFooterBtn);

    await waitFor(() => {
      expect(studioApi.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Benim Projem' }),
      );
    });
  });

  it('takim sablonu secildiginde template gosterilmeli', async () => {
    const user = userEvent.setup();
    const sablon: TeamTemplate = {
      id: 'tmpl-1',
      name: 'Full Stack Takim',
      description: 'Frontend ve backend ajanlar',
      roles: ['Frontend Dev', 'Backend Dev', 'QA'],
      createdAt: '2026-01-01T00:00:00Z',
    };
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([sablon]);
    renderSayfa();

    await waitFor(() => screen.getByText('New Project'));
    await user.click(screen.getByText('New Project'));

    await waitFor(() => {
      expect(screen.getByText('Full Stack Takim')).toBeInTheDocument();
    });
  });
});

describe('StudioHomePage — proje silme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchTeamTemplates).mockResolvedValue([]);
    vi.mocked(studioApi.deleteProject).mockResolvedValue(undefined);
  });

  it('onay verilince deleteProject API cagrisi yapilmali', async () => {
    vi.mocked(studioApi.fetchProjects).mockResolvedValue([ORNEK_PROJELER[0]]);
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
