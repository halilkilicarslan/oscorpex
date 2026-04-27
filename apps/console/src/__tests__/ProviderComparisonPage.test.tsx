import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ProviderComparisonPage from '../pages/studio/ProviderComparisonPage';

const mockLatency = [
  {
    providerId: 'claude-code',
    totalExecutions: 100,
    successfulExecutions: 95,
    failedExecutions: 5,
    averageLatencyMs: 1200,
    p95LatencyMs: 2500,
    lastFailureAt: null,
    lastFailureClassification: null,
  },
  {
    providerId: 'gemini',
    totalExecutions: 80,
    successfulExecutions: 72,
    failedExecutions: 8,
    averageLatencyMs: 800,
    p95LatencyMs: 1500,
    lastFailureAt: null,
    lastFailureClassification: null,
  },
];

const mockRecords = [
  {
    runId: 'r1',
    taskId: 't1',
    primaryProvider: 'claude-code',
    finalProvider: 'claude-code',
    latencyMs: 1200,
    success: true,
    fallbackCount: 0,
    fallbackTimeline: [],
    errorClassification: null,
    errorMessage: null,
    degradedMode: false,
    degradedMessage: null,
    canceled: false,
    cancelReason: null,
    retryReason: null,
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:00:01Z',
    queueWaitMs: 100,
  },
  {
    runId: 'r2',
    taskId: 't2',
    primaryProvider: 'gemini',
    finalProvider: 'gemini',
    latencyMs: 800,
    success: true,
    fallbackCount: 0,
    fallbackTimeline: [],
    errorClassification: null,
    errorMessage: null,
    degradedMode: false,
    degradedMessage: null,
    canceled: false,
    cancelReason: null,
    retryReason: null,
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:00:01Z',
    queueWaitMs: 50,
  },
];

vi.mock('../lib/studio-api', () => ({
  fetchProviderLatency: vi.fn().mockResolvedValue({ providers: mockLatency }),
  fetchProviderRecords: vi.fn().mockResolvedValue({ total: 2, records: mockRecords }),
}));

describe('ProviderComparisonPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    render(<ProviderComparisonPage />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders comparison table with provider data', async () => {
    render(<ProviderComparisonPage />);
    await waitFor(() => {
      expect(screen.getByText('claude-code')).toBeInTheDocument();
      expect(screen.getByText('gemini')).toBeInTheDocument();
    });
  });

  it('shows fastest badge for provider with lowest latency', async () => {
    render(<ProviderComparisonPage />);
    await waitFor(() => {
      expect(screen.getByText('Fastest')).toBeInTheDocument();
    });
  });
});
