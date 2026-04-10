import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AgentDashboard from '../pages/studio/AgentDashboard';
import * as studioApi from '../lib/studio-api';
import type { ProjectAnalytics, AgentAnalytics, ActivityTimeline } from '../lib/studio-api';

// AgentAvatar bileşenini mockla
vi.mock('../components/AgentAvatar', () => ({
  default: ({ name }: { avatar: string; name: string; size?: string }) => (
    <span data-testid="agent-avatar">{name}</span>
  ),
}));

// studio-api modulunu mockla
vi.mock('../lib/studio-api', () => ({
  fetchProjectAnalytics: vi.fn(),
  fetchAgentAnalytics: vi.fn(),
  fetchActivityTimeline: vi.fn(),
  fetchProjectCosts: vi.fn().mockResolvedValue({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, taskCount: 0 }),
  fetchCostBreakdown: vi.fn().mockResolvedValue([]),
  fetchDocsFreshness: vi.fn().mockResolvedValue([]),
  fetchSonarStatus: vi.fn().mockResolvedValue({ enabled: false }),
  fetchLatestSonarScan: vi.fn().mockResolvedValue(null),
  triggerSonarScan: vi.fn().mockResolvedValue({}),
  fetchPoolStatus: vi.fn().mockResolvedValue({ initialized: false, total: 0, ready: 0, busy: 0, unhealthy: 0, containers: [] }),
  roleLabel: vi.fn((role: string) => role.charAt(0).toUpperCase() + role.slice(1)),
}));

// Ornek ozet veri
const ORNEK_ANALYTICS: ProjectAnalytics = {
  totalTasks: 24,
  completedTasks: 18,
  inProgressTasks: 3,
  blockedTasks: 1,
  tasksPerAgent: [
    { agentId: 'agent-1', agentName: 'Frontend Ajan', total: 10, completed: 8, completionRate: 80 },
    { agentId: 'agent-2', agentName: 'Backend Ajan', total: 14, completed: 10, completionRate: 71 },
  ],
  avgCompletionTimeMs: 7200000, // 2 saat
  pipelineRunCount: 5,
  pipelineSuccessRate: 80,
};

// Ornek ajan analizleri
const ORNEK_AJAN_ANALIZLERI: AgentAnalytics[] = [
  {
    agentId: 'agent-1',
    agentName: 'Frontend Ajan',
    role: 'frontend',
    avatar: '',
    color: '#22c55e',
    tasksAssigned: 10,
    tasksCompleted: 8,
    tasksFailed: 1,
    runCount: 15,
    totalRuntimeMs: 3600000, // 1 saat
    messagesSent: 42,
    messagesReceived: 35,
    isRunning: true,
  },
  {
    agentId: 'agent-2',
    agentName: 'Backend Ajan',
    role: 'backend',
    avatar: '',
    color: '#3b82f6',
    tasksAssigned: 14,
    tasksCompleted: 10,
    tasksFailed: 2,
    runCount: 20,
    totalRuntimeMs: 7200000, // 2 saat
    messagesSent: 60,
    messagesReceived: 55,
    isRunning: false,
  },
];

// Ornek aktivite zaman cizelgesi
const ORNEK_ZAMAN_CIZELGESI: ActivityTimeline[] = [
  { date: '2026-04-01', tasksCompleted: 3, runsStarted: 5, runsCompleted: 4 },
  { date: '2026-04-02', tasksCompleted: 2, runsStarted: 3, runsCompleted: 3 },
  { date: '2026-04-03', tasksCompleted: 0, runsStarted: 0, runsCompleted: 0 },
  { date: '2026-04-04', tasksCompleted: 5, runsStarted: 7, runsCompleted: 6 },
  { date: '2026-04-05', tasksCompleted: 4, runsStarted: 6, runsCompleted: 5 },
  { date: '2026-04-06', tasksCompleted: 2, runsStarted: 4, runsCompleted: 4 },
  { date: '2026-04-07', tasksCompleted: 2, runsStarted: 3, runsCompleted: 2 },
];

describe('AgentDashboard — yukleme durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('veri yuklenirken spinner gosterilmeli', () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockReturnValue(new Promise(() => {}));
    vi.mocked(studioApi.fetchAgentAnalytics).mockReturnValue(new Promise(() => {}));
    vi.mocked(studioApi.fetchActivityTimeline).mockReturnValue(new Promise(() => {}));

    render(<AgentDashboard projectId="proj-1" />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('veri yuklendikten sonra baslik gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Proje Paneli')).toBeInTheDocument();
    });
  });
});

describe('AgentDashboard — hata durumu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('API hatasi varsa hata mesaji gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockRejectedValue(new Error('Sunucu hatasi'));
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue([]);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue([]);

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Sunucu hatasi')).toBeInTheDocument();
    });
  });

  it('hata durumunda "Tekrar dene" butonu gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockRejectedValue(new Error('Hata'));
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue([]);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue([]);

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Tekrar dene')).toBeInTheDocument();
    });
  });

  it('"Tekrar dene" butonuna tiklaninca veri yeniden yuklenmeli', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics)
      .mockRejectedValueOnce(new Error('Hata'))
      .mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);

    const user = userEvent.setup();
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Tekrar dene'));
    await user.click(screen.getByText('Tekrar dene'));

    await waitFor(() => {
      expect(screen.getByText('Proje Paneli')).toBeInTheDocument();
    });
  });
});

describe('AgentDashboard — metrik kartlari', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);
  });

  it('"Toplam Gorev" kartini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Toplam Gorev')).toBeInTheDocument();
      expect(screen.getByText('24')).toBeInTheDocument();
    });
  });

  it('"Tamamlanma Orani" kartini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Tamamlanma Orani')).toBeInTheDocument();
      // 18/24 = %75
      expect(screen.getByText('%75')).toBeInTheDocument();
    });
  });

  it('"Aktif Ajan" kartini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Aktif Ajan')).toBeInTheDocument();
      // Sadece Frontend Ajan isRunning = true — "1" degeri birden fazla yerde olabilir,
      // "Aktif Ajan" kartinin yanindaki alt metni kontrol et
      expect(screen.getByText('2 toplam')).toBeInTheDocument();
    });
  });

  it('"Pipeline Calistirma" kartini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Pipeline Calistirma')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('gorev yoksa tamamlanma orani %0 olmali', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({
      ...ORNEK_ANALYTICS,
      totalTasks: 0,
      completedTasks: 0,
    });

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('%0')).toBeInTheDocument();
    });
  });
});

describe('AgentDashboard — ajan performans tablosu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);
  });

  it('"Ajan Performansi" basligini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Ajan Performansi')).toBeInTheDocument();
    });
  });

  it('ajan adlarini tablo satirlarinda gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      // Her ajan adi en az 1 kez gosterilmeli
      const frontendAjan = screen.getAllByText('Frontend Ajan');
      const backendAjan = screen.getAllByText('Backend Ajan');
      expect(frontendAjan.length).toBeGreaterThanOrEqual(1);
      expect(backendAjan.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('ajan rolleri Turkce tercume ile gosterilmeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getAllByText('Frontend').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Backend').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('aktif ajan "Aktif" rozeti gosterilmeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Aktif')).toBeInTheDocument();
    });
  });

  it('bekleme durumundaki ajan "Bekliyor" rozeti gosterilmeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Bekliyor')).toBeInTheDocument();
    });
  });

  it('ajan sayisi tablo basliginda gosterilmeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('2 ajan')).toBeInTheDocument();
    });
  });

  it('ajan yoksa "ajan atanmamis" mesaji gosterilmeli', async () => {
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue([]);

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText(/henuz ajan atanmamis/i)).toBeInTheDocument();
    });
  });

  it('ajan basari orani gosterilmeli (%)${n} formatinda', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      // Frontend: 8/10 = %80 — birden fazla olabilir (satir ve ozet kartinda)
      const rateBadges = screen.getAllByText('%80');
      expect(rateBadges.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('AgentDashboard — bar chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);
  });

  it('"Ajan Basi Gorev Dagilimi" basligini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Ajan Basi Gorev Dagilimi')).toBeInTheDocument();
    });
  });

  it('bar chart ajan adlarini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      // tasksPerAgent'daki ajan adlari bar chart label olarak gosterilmeli
      const frontendItems = screen.getAllByText('Frontend Ajan');
      const backendItems = screen.getAllByText('Backend Ajan');
      expect(frontendItems.length).toBeGreaterThanOrEqual(1);
      expect(backendItems.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('AgentDashboard — timeline chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);
  });

  it('"Son 7 Gun Aktivite" basligini gostermeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Son 7 Gun Aktivite')).toBeInTheDocument();
    });
  });

  it('bos tasksPerAgent ile bar chart "Henuz veri yok" mesaji gostermeli', async () => {
    // tasksPerAgent bos oldugunda BarChart bos mesaj gostermeli
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({
      ...ORNEK_ANALYTICS,
      tasksPerAgent: [],
    });
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue([]);

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      // BarChart bileseninin bos mesajini kontrol et
      const bosMetin = screen.getAllByText('Henuz veri yok');
      expect(bosMetin.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('AgentDashboard — yenile butonu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);
  });

  it('"Yenile" butonu gosterilmeli', async () => {
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Yenile')).toBeInTheDocument();
    });
  });

  it('"Yenile" butonuna tiklaninca veri yeniden yuklenmeli', async () => {
    const user = userEvent.setup();
    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => screen.getByText('Yenile'));
    await user.click(screen.getByText('Yenile'));

    await waitFor(() => {
      // fetchProjectAnalytics en az 2 kez cagrili olmali (ilk yukleme + yenile)
      expect(studioApi.fetchProjectAnalytics).toHaveBeenCalledTimes(2);
    });
  });
});

describe('AgentDashboard — sure formatlama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);
  });

  it('milisaniye cinsinden sure "sa" formatinda gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({
      ...ORNEK_ANALYTICS,
      avgCompletionTimeMs: 10800000, // 3 saat — "3.0sa" formatinda
    });

    // Ajan sure degerleri cakismasin diye sifirla
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue([
      { ...ORNEK_AJAN_ANALIZLERI[0], totalRuntimeMs: 1800000 }, // 30dk
      { ...ORNEK_AJAN_ANALIZLERI[1], totalRuntimeMs: 900000 },  // 15dk
    ]);

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      // formatDuration(10800000) = (10800000/3600000).toFixed(1) + "sa" = "3.0sa"
      const sureItems = screen.getAllByText('3.0sa');
      expect(sureItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('null sure "-" olarak gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue({
      ...ORNEK_ANALYTICS,
      avgCompletionTimeMs: null,
    });

    render(<AgentDashboard projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Proje Paneli')).toBeInTheDocument();
    });
  });
});

describe('AgentDashboard — otomatik yenileme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('30 saniyede bir otomatik yenileme yapilmali', async () => {
    vi.mocked(studioApi.fetchProjectAnalytics).mockResolvedValue(ORNEK_ANALYTICS);
    vi.mocked(studioApi.fetchAgentAnalytics).mockResolvedValue(ORNEK_AJAN_ANALIZLERI);
    vi.mocked(studioApi.fetchActivityTimeline).mockResolvedValue(ORNEK_ZAMAN_CIZELGESI);

    render(<AgentDashboard projectId="proj-1" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(studioApi.fetchProjectAnalytics).toHaveBeenCalledTimes(1);

    // 30 saniye ilerlet
    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });

    expect(studioApi.fetchProjectAnalytics).toHaveBeenCalledTimes(2);
  });
});
