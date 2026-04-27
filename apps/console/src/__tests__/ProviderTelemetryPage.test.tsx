import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProviderTelemetryPage from '../pages/studio/ProviderTelemetryPage';
import * as studioApi from '../lib/studio-api';
import type { ProviderLatencySnapshot, ProviderExecutionTelemetry } from '../lib/studio-api';

vi.mock('../lib/studio-api', () => ({
  fetchProviderLatency: vi.fn(),
  fetchProviderRecords: vi.fn(),
}));

const SAMPLE_LATENCY: ProviderLatencySnapshot[] = [
  {
    providerId: 'claude-code',
    totalExecutions: 12,
    successfulExecutions: 10,
    failedExecutions: 2,
    averageLatencyMs: 3450,
    p95LatencyMs: 8900,
    lastFailureAt: '2026-04-26T10:00:00Z',
    lastFailureClassification: 'timeout',
  },
  {
    providerId: 'codex',
    totalExecutions: 8,
    successfulExecutions: 7,
    failedExecutions: 1,
    averageLatencyMs: 2100,
    p95LatencyMs: 4300,
  },
];

const SAMPLE_RECORDS: ProviderExecutionTelemetry[] = [
  {
    runId: 'run-1',
    taskId: 'task-a',
    startedAt: '2026-04-27T08:00:00Z',
    completedAt: '2026-04-27T08:00:05Z',
    primaryProvider: 'claude-code',
    finalProvider: 'codex',
    success: true,
    latencyMs: 5200,
    fallbackCount: 1,
    fallbackTimeline: [
      {
        timestamp: '2026-04-27T08:00:02Z',
        fromProvider: 'claude-code',
        toProvider: 'codex',
        reason: 'timeout',
        errorClassification: 'timeout',
        latencyMs: 2100,
      },
    ],
  },
  {
    runId: 'run-2',
    taskId: 'task-b',
    startedAt: '2026-04-27T09:00:00Z',
    primaryProvider: 'cursor',
    success: false,
    latencyMs: 1200,
    fallbackCount: 0,
    fallbackTimeline: [],
    errorClassification: 'unavailable',
    errorMessage: 'cursor binary not found',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ProviderTelemetryPage />
    </MemoryRouter>,
  );
}

describe('ProviderTelemetryPage — yukleme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yuklenirken spinner gosterilmeli', () => {
    vi.mocked(studioApi.fetchProviderLatency).mockReturnValue(new Promise(() => {}));
    vi.mocked(studioApi.fetchProviderRecords).mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('veriler yuklendikten sonra baslik ve ozet kartlari gosterilmeli', async () => {
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: SAMPLE_LATENCY });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: SAMPLE_RECORDS.length, records: SAMPLE_RECORDS });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Provider Telemetry')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument(); // total runs
      expect(screen.getByText('17')).toBeInTheDocument(); // successful
      expect(screen.getByText('3')).toBeInTheDocument(); // failed
    });
  });
});

describe('ProviderTelemetryPage — latency kartlari', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: SAMPLE_LATENCY });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: 0, records: [] });
  });

  it('her provider icin latency karti render edilmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('claude-code').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('codex').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('latency degerleri formatlanmis sekilde gosterilmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('3.5s').length).toBeGreaterThanOrEqual(1); // avg claude
      expect(screen.getAllByText('8.9s').length).toBeGreaterThanOrEqual(1); // p95 claude
      expect(screen.getAllByText('2.1s').length).toBeGreaterThanOrEqual(1); // avg codex
    });
  });

  it('son hata bilgisi gosterilmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Last failure:/)).toBeInTheDocument();
      expect(screen.getByText('Timeout')).toBeInTheDocument();
    });
  });
});

describe('ProviderTelemetryPage — kayitlar tablosu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: SAMPLE_LATENCY });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: SAMPLE_RECORDS.length, records: SAMPLE_RECORDS });
  });

  it('kayitlar tablosunda execution verileri listelenmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('task-a')).toBeInTheDocument();
      expect(screen.getByText('task-b')).toBeInTheDocument();
    });
  });

  it('basarili ve basarisiz durum rozetleri gosterilmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('success')).toBeInTheDocument();
      expect(screen.getByText('failed')).toBeInTheDocument();
    });
  });

  it('fallback sayisi gosterilmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('ProviderTelemetryPage — detay cekmecesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: SAMPLE_LATENCY });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: SAMPLE_RECORDS.length, records: SAMPLE_RECORDS });
  });

  it('kayita tiklaninca detay cekmecesi acilmali', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('task-a'));
    await user.click(screen.getByText('task-a'));

    await waitFor(() => {
      expect(screen.getByText('Execution Detail')).toBeInTheDocument();
      expect(screen.getByText('Fallback Timeline')).toBeInTheDocument();
    });
  });

  it('cekmece kapatma butonu calismali', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('task-a'));
    await user.click(screen.getByText('task-a'));

    await waitFor(() => screen.getByText('Execution Detail'));

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    await user.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Execution Detail')).not.toBeInTheDocument();
    });
  });

  it('hata mesaji iceren kayitta error paneli gosterilmeli', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('task-b'));
    await user.click(screen.getByText('task-b'));

    await waitFor(() => {
      expect(screen.getByText('cursor binary not found')).toBeInTheDocument();
    });
  });
});

describe('ProviderTelemetryPage — filtreleme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: SAMPLE_LATENCY });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: SAMPLE_RECORDS.length, records: SAMPLE_RECORDS });
  });

  it('provider filtresi degistiginde API cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('Execution Records'));

    const providerSelect = screen.getByDisplayValue('All providers');
    await user.selectOptions(providerSelect, 'codex');

    await waitFor(() => {
      expect(studioApi.fetchProviderRecords).toHaveBeenCalledWith(
        100,
        'codex',
        undefined,
      );
    });
  });

  it('status filtresi degistiginde API cagrisi yapilmali', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('Execution Records'));

    const statusSelect = screen.getByDisplayValue('All statuses');
    await user.selectOptions(statusSelect, 'success');

    await waitFor(() => {
      expect(studioApi.fetchProviderRecords).toHaveBeenCalledWith(
        100,
        undefined,
        true,
      );
    });
  });
});

describe('ProviderTelemetryPage — bos durum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: [] });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: 0, records: [] });
  });

  it('kayit yoksa bos mesaj gosterilmeli', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No execution records found.')).toBeInTheDocument();
    });
  });
});

describe('ProviderTelemetryPage — refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studioApi.fetchProviderLatency).mockResolvedValue({ providers: SAMPLE_LATENCY });
    vi.mocked(studioApi.fetchProviderRecords).mockResolvedValue({ total: 0, records: [] });
  });

  it('refresh butonuna tiklaninca veriler yeniden yuklenmeli', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => screen.getByText('Refresh'));
    await user.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(studioApi.fetchProviderLatency).toHaveBeenCalledTimes(2);
      expect(studioApi.fetchProviderRecords).toHaveBeenCalledTimes(2);
    });
  });
});
