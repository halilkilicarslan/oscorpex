import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProjectPage from '../pages/studio/ProjectPage';
import * as studioApi from '../lib/studio-api';
import type { Project, ProjectAgent } from '../lib/studio-api';

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
  fetchProject: vi.fn(),
  fetchProjectAgents: vi.fn(),
  fetchUnreadCount: vi.fn(),
  fetchAppStatus: vi.fn().mockResolvedValue({ running: false, backendUrl: null, frontendUrl: null }),
  startApp: vi.fn().mockResolvedValue({ ok: true }),
  stopApp: vi.fn().mockResolvedValue({ ok: true }),
}));

// Alt bilesenler — sadece stub render et
vi.mock('../pages/studio/PMChat', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="pm-chat">PM Chat — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/AgentGrid', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="agent-grid">Agent Grid — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/KanbanBoard', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="kanban-board">Kanban Board — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/PipelineDashboard', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="pipeline-dashboard">Pipeline Dashboard — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/FileExplorer', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="file-explorer">File Explorer — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/EventFeed', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="event-feed">Event Feed — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/MessageCenter', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="message-center">Message Center — {projectId}</div>
  ),
}));

vi.mock('../pages/studio/AgentDashboard', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="agent-dashboard">Agent Dashboard — {projectId}</div>
  ),
}));

const ORNEK_PROJE: Project = {
  id: 'proj-1',
  name: 'Test Projesi',
  description: 'Test aciklamasi',
  status: 'running',
  techStack: ['React', 'Node.js'],
  repoPath: '/repos/test',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const ORNEK_AJANLAR: ProjectAgent[] = [
  {
    id: 'agent-1',
    projectId: 'proj-1',
    name: 'Frontend Ajan',
    role: 'frontend',
    avatar: 'F',
    personality: 'Dikkatli',
    model: 'claude-sonnet-4-6',
    cliTool: 'claude',
    skills: ['React'],
    systemPrompt: 'Frontend gelistirici',
    createdAt: '2026-01-01T00:00:00Z',
    color: '#22c55e',
    pipelineOrder: 1,
  },
];

// ProjectPage'i MemoryRouter ile render eden yardimci fonksiyon
function renderProjectPage(projectId = 'proj-1') {
  return render(
    <MemoryRouter initialEntries={[`/studio/projects/${projectId}`]}>
      <Routes>
        <Route path="/studio/projects/:projectId" element={<ProjectPage />} />
        <Route path="/studio" element={<div>Studio Ana Sayfa</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectPage — yukleme durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
  });

  it('proje yuklenirken spinner gosterilmeli', () => {
    vi.mocked(studioApi.fetchProject).mockReturnValue(new Promise(() => {}));

    renderProjectPage();

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('proje yuklendikten sonra basligi gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProject).mockResolvedValue(ORNEK_PROJE);

    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Test Projesi')).toBeInTheDocument();
    });
  });

  it('proje bulunamazsa studio anasayfasina yonlendirmeli', async () => {
    vi.mocked(studioApi.fetchProject).mockRejectedValue(new Error('404 Not Found'));

    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Studio Ana Sayfa')).toBeInTheDocument();
    });
  });
});

describe('ProjectPage — proje header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProject).mockResolvedValue(ORNEK_PROJE);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
  });

  it('proje adi gosterilmeli', async () => {
    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Test Projesi')).toBeInTheDocument();
    });
  });

  it('proje durumu gosterilmeli', async () => {
    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
    });
  });

  it('tech stack gosterilmeli', async () => {
    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('React, Node.js')).toBeInTheDocument();
    });
  });

  it('tech stack yoksa ayirac gosterilmemeli', async () => {
    vi.mocked(studioApi.fetchProject).mockResolvedValue({
      ...ORNEK_PROJE,
      techStack: [],
    });

    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Test Projesi')).toBeInTheDocument();
    });

    // Ayirac boru karakteri DOM'da olmamali
    expect(screen.queryByText('|')).not.toBeInTheDocument();
  });

  it('geri butonu gosterilmeli', async () => {
    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Test Projesi')).toBeInTheDocument();
    });

    // ArrowLeft ikonunu iceren buton DOM'da olmali
    const buttons = document.querySelectorAll('button');
    // header'daki ilk buton geri butonu
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('ProjectPage — sekme navigasyonu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProject).mockResolvedValue(ORNEK_PROJE);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
  });

  it('tum sekmeler gosterilmeli', async () => {
    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Planner')).toBeInTheDocument();
      expect(screen.getByText('Team')).toBeInTheDocument();
      expect(screen.getByText('Board')).toBeInTheDocument();
      expect(screen.getByText('Files')).toBeInTheDocument();
      expect(screen.getByText('Events')).toBeInTheDocument();
      expect(screen.getByText('Messages')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('varsayilan olarak Planner sekmesi aktif olmali', async () => {
    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByTestId('pm-chat')).toBeInTheDocument();
    });
  });

  it('Team sekmesine tiklaninca AgentGrid render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Team'));

    await user.click(screen.getByText('Team'));

    expect(screen.getByTestId('agent-grid')).toBeInTheDocument();
  });

  it('Board sekmesine tiklaninca KanbanBoard render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Board'));

    await user.click(screen.getByText('Board'));

    expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
  });

  it('Files sekmesine tiklaninca FileExplorer render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Files'));

    await user.click(screen.getByText('Files'));

    expect(screen.getByTestId('file-explorer')).toBeInTheDocument();
  });

  it('Events sekmesine tiklaninca EventFeed render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Events'));

    await user.click(screen.getByText('Events'));

    expect(screen.getByTestId('event-feed')).toBeInTheDocument();
  });

  it('Messages sekmesine tiklaninca MessageCenter render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Messages'));

    await user.click(screen.getByText('Messages'));

    expect(screen.getByTestId('message-center')).toBeInTheDocument();
  });

  it('Dashboard sekmesine tiklaninca AgentDashboard render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Dashboard'));

    await user.click(screen.getByText('Dashboard'));

    expect(screen.getByTestId('agent-dashboard')).toBeInTheDocument();
  });
});

describe('ProjectPage — Board sekmesi kanban/pipeline secimi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProject).mockResolvedValue(ORNEK_PROJE);
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
  });

  it('Board sekmesinde kanban ve pipeline geciş butonlari gosterilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Board'));
    await user.click(screen.getByText('Board'));

    expect(screen.getByText('Kanban')).toBeInTheDocument();
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
  });

  it('varsayilan board gorunumu kanban olmali', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Board'));
    await user.click(screen.getByText('Board'));

    expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
    expect(screen.queryByTestId('pipeline-dashboard')).not.toBeInTheDocument();
  });

  it('Pipeline butonuna tiklaninca PipelineDashboard render edilmeli', async () => {
    const user = userEvent.setup();
    renderProjectPage();

    await waitFor(() => screen.getByText('Board'));
    await user.click(screen.getByText('Board'));

    await user.click(screen.getByText('Pipeline'));

    expect(screen.getByTestId('pipeline-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument();
  });
});

describe('ProjectPage — Messages sekmesi okunmamis rozeti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProject).mockResolvedValue(ORNEK_PROJE);
  });

  it('okunmamis mesaj varsa Messages sekmesinde rozet gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 5 });

    renderProjectPage();

    await waitFor(() => {
      // Rozet (sayac) DOM'da olmali
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('okunmamis mesaj yoksa rozet gosterilmemeli', async () => {
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue([]);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });

    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('Test Projesi')).toBeInTheDocument();
    });

    // Sayac rozeti olmamali
    const badge = screen.queryByText(/^\d+$/);
    expect(badge).toBeNull();
  });

  it('99dan fazla mesaj varsa "99+" gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAgents).mockResolvedValue(ORNEK_AJANLAR);
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 150 });

    renderProjectPage();

    await waitFor(() => {
      expect(screen.getByText('99+')).toBeInTheDocument();
    });
  });
});
