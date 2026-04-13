import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentCard from '../pages/studio/AgentCard';
import * as studioApi from '../lib/studio-api';
import type { ProjectAgent } from '../lib/studio-api';

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
  startAgentProcess: vi.fn(),
  stopAgentProcess: vi.fn(),
  getAgentStatus: vi.fn(),
  getAgentRunHistory: vi.fn(),
  fetchUnreadCount: vi.fn(),
  roleLabel: vi.fn((role: string) => role),
}));

// AgentTerminal bagimliligi — terminal testi yok, sadece mockla
vi.mock('../pages/studio/AgentTerminal', () => ({
  default: () => <div data-testid="agent-terminal">Terminal Mock</div>,
}));

const ORNEK_AJAN: ProjectAgent = {
  id: 'agent-1',
  projectId: 'proj-1',
  name: 'Frontend Gelistirici',
  role: 'frontend-developer',
  avatar: '👨‍💻',
  gender: 'male',
  personality: 'Dikkatlı ve metodolojik',
  model: 'claude-sonnet-4-6',
  cliTool: 'claude',
  skills: ['React', 'TypeScript', 'CSS', 'Testing', 'GraphQL'],
  systemPrompt: 'Sen bir frontend gelistiricisin',
  createdAt: '2026-01-01T00:00:00Z',
  color: '#22c55e',
  pipelineOrder: 1,
};

// Varsayilan prop degerlerini iceren yardimci render fonksiyonu
function renderAgentCard(
  propOverrides: Partial<{
    agent: ProjectAgent;
    projectId: string;
    status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
    onStart: () => Promise<void>;
    onStop: () => Promise<void>;
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
  }> = {},
) {
  const props = {
    agent: ORNEK_AJAN,
    projectId: 'proj-1',
    status: 'idle' as const,
    onStart: vi.fn().mockResolvedValue(undefined),
    onStop: vi.fn().mockResolvedValue(undefined),
    ...propOverrides,
  };

  return render(<AgentCard {...props} />);
}

describe('AgentCard — ajan bilgisi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'idle',
    });
  });

  it('ajan adini gostermeli', () => {
    renderAgentCard();
    expect(screen.getByText('Frontend Gelistirici')).toBeInTheDocument();
  });

  it('ajan rolunu gostermeli', () => {
    renderAgentCard();
    expect(screen.getByText('frontend-developer')).toBeInTheDocument();
  });

  it('ajan avatar\'ini gostermeli', () => {
    renderAgentCard();
    expect(screen.getByText('👨‍💻')).toBeInTheDocument();
  });

  it('kaynak ajan olmadan Custom rozeti gostermeli', () => {
    renderAgentCard();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('kaynak ajan varsa Template rozeti gostermeli', () => {
    renderAgentCard({
      agent: { ...ORNEK_AJAN, sourceAgentId: 'preset-agent-1' },
    });
    expect(screen.getByText('Template')).toBeInTheDocument();
  });

  it('ilk 4 yetenegi gostermeli', () => {
    renderAgentCard();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('CSS')).toBeInTheDocument();
    expect(screen.getByText('Testing')).toBeInTheDocument();
  });

  it('4\'ten fazla yetenek varsa "+N" gostermeli', () => {
    renderAgentCard();
    // 5 yetenek var (React, TypeScript, CSS, Testing, GraphQL), 4'u gosterilir
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('yetenek yoksa skill bolumu gosterilmemeli', () => {
    renderAgentCard({ agent: { ...ORNEK_AJAN, skills: [] } });
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
  });

  it('sol border rengi ajan rengini yansitmali', () => {
    renderAgentCard();
    const card = document.querySelector('[style*="border-left-color"]');
    expect(card).toBeTruthy();
    expect((card as HTMLElement).style.borderLeftColor).toBe('rgb(34, 197, 94)'); // #22c55e
  });
});

describe('AgentCard — durum rozeti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'idle',
    });
  });

  it('idle durumda durum gostergesi olmali', () => {
    renderAgentCard({ status: 'idle' });
    // Durum noktasi title ile "Idle" gostermeli
    const dot = document.querySelector('[title="Idle"]');
    expect(dot).toBeTruthy();
  });

  it('running durumda durum gostergesi olmali', () => {
    renderAgentCard({ status: 'running' });
    const dot = document.querySelector('[title="Running"]');
    expect(dot).toBeTruthy();
  });

  it('error durumda durum gostergesi olmali', () => {
    renderAgentCard({ status: 'error' });
    const dot = document.querySelector('[title="Error"]');
    expect(dot).toBeTruthy();
  });

  it('stopped durumda durum gostergesi olmali', () => {
    renderAgentCard({ status: 'stopped' });
    const dot = document.querySelector('[title="Stopped"]');
    expect(dot).toBeTruthy();
  });
});

describe('AgentCard — baslat/durdur butonu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'idle',
    });
  });

  it('idle durumda "Baslat" title\'li buton gosterilmeli', () => {
    renderAgentCard({ status: 'idle' });
    const btn = screen.getByTitle('Başlat');
    expect(btn).toBeInTheDocument();
  });

  it('running durumda "Durdur" title\'li buton gosterilmeli', () => {
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'running',
    });
    renderAgentCard({ status: 'running' });
    const btn = screen.getByTitle('Durdur');
    expect(btn).toBeInTheDocument();
  });

  it('idle durumda baslat butonuna tiklaninca onStart cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    vi.mocked(studioApi.startAgentProcess).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'running',
      pid: 12345,
    });
    const onStart = vi.fn().mockResolvedValue(undefined);

    renderAgentCard({ status: 'idle', onStart });

    await user.click(screen.getByTitle('Başlat'));

    await waitFor(() => {
      expect(onStart).toHaveBeenCalled();
    });
  });

  it('running durumda durdur butonuna tiklaninca onStop cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    vi.mocked(studioApi.stopAgentProcess).mockResolvedValue(undefined);
    const onStop = vi.fn().mockResolvedValue(undefined);

    renderAgentCard({ status: 'running', onStop });

    await user.click(screen.getByTitle('Durdur'));

    await waitFor(() => {
      expect(onStop).toHaveBeenCalled();
    });
  });

  it('running durumda terminal butonu gosterilmeli', () => {
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'running',
    });
    renderAgentCard({ status: 'running' });

    const terminalBtn = screen.getByTitle('Terminal aç/kapat');
    expect(terminalBtn).toBeInTheDocument();
  });

  it('idle durumda terminal butonu gosterilmemeli', () => {
    renderAgentCard({ status: 'idle' });
    expect(screen.queryByTitle('Terminal aç/kapat')).not.toBeInTheDocument();
  });
});

describe('AgentCard — duzenle ve sil butonlari', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'idle',
    });
  });

  it('onEdit prop verilince duzenle butonu gosterilmeli', () => {
    const onEdit = vi.fn();
    renderAgentCard({ onEdit });
    expect(screen.getByTitle('Ajanı düzenle')).toBeInTheDocument();
  });

  it('onEdit prop verilmezse duzenle butonu gosterilmemeli', () => {
    renderAgentCard();
    expect(screen.queryByTitle('Ajanı düzenle')).not.toBeInTheDocument();
  });

  it('duzenle butonuna tiklaninca onEdit cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderAgentCard({ onEdit });

    await user.click(screen.getByTitle('Ajanı düzenle'));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('onDelete prop verilince sil butonu gosterilmeli', () => {
    const onDelete = vi.fn();
    renderAgentCard({ onDelete });
    expect(screen.getByTitle('Ajanı sil')).toBeInTheDocument();
  });

  it('sil butonuna tiklaninca onDelete cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderAgentCard({ onDelete });

    await user.click(screen.getByTitle('Ajanı sil'));
    expect(onDelete).toHaveBeenCalledOnce();
  });
});

describe('AgentCard — okunmamis mesaj sayaci', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.getAgentStatus).mockResolvedValue({
      id: 'agent-1',
      agentId: 'agent-1',
      agentName: 'Frontend Gelistirici',
      cliTool: 'claude',
      status: 'idle',
    });
  });

  it('okunmamis mesaj yoksa rozet gosterilmemeli', async () => {
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 0 });

    renderAgentCard();

    // Rozet asenkron olarak yuklenir — beklememiz gerekiyor
    await waitFor(() => {
      expect(screen.queryByTitle(/okunmamış mesaj/)).not.toBeInTheDocument();
    });
  });

  it('okunmamis mesaj varsa sayac rozeti gosterilmeli', async () => {
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 3 });

    renderAgentCard();

    await waitFor(() => {
      expect(screen.getByTitle('3 okunmamış mesaj')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('9\'dan fazla mesaj varsa "9+" gosterilmeli', async () => {
    vi.mocked(studioApi.fetchUnreadCount).mockResolvedValue({ agentId: 'agent-1', unreadCount: 15 });

    renderAgentCard();

    await waitFor(() => {
      expect(screen.getByText('9+')).toBeInTheDocument();
    });
  });
});
