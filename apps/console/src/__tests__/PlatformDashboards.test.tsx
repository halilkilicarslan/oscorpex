import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlatformDashboard from '../pages/studio/PlatformDashboard';
import InsightDashboard from '../pages/studio/InsightDashboard';
import * as studioApi from '../lib/studio-api';

// F2c: platform dashboards are fed by aggregate-only endpoints (no project/task/file identifiers).
// Sections that listed "recent projects/tasks" / per-project / per-file rows now show counts.

vi.mock('../lib/studio-api', () => ({
  fetchPlatformStats: vi.fn(),
  fetchPlatformAnalytics: vi.fn(),
}));

const STATS = {
  projects: { total: 4242, active: 3, completed: 11, failed: 2 },
  tasks: { total: 987, done: 700, running: 12, failed: 30, queued: 245 },
  cost: {
    totalUsd: 123.45,
    totalTokens: 5550000,
    cacheReadTokens: 4000000,
    cacheCreationTokens: 500000,
    cacheRate: 88,
    activeAgents: 9,
  },
  // aggregates only — the server no longer sends these lists
  recentProjects: [],
  recentTasks: [],
};

const ANALYTICS = {
  totals: {
    totalProjects: 3737,
    totalTasks: 500,
    tasksDone: 400,
    tasksFailed: 20,
    taskDoneRate: 80,
    failureRate: 4,
    uniqueAgents: 6,
    avgTaskMin: 7,
    totalCostUsd: 77.7,
    cacheRate: 91,
    totalEvents: 1234,
    totalErrors: 21,
    errorRate: 1.7,
    activeDays: 14,
  },
  agentUsage: [{ agent: 'agent-x', role: 'backend-dev', count: 55 }],
  dailyActivity: [{ date: '2026-10-27', events: 100, errors: 2, completions: 9 }],
  hourlyPattern: [{ hour: 10, count: 40 }],
  projectActivity: [],
  fileActivity: [],
  complexityDistribution: [{ complexity: 'XL', count: 5 }],
  eventTypes: [{ type: 'task:completed', count: 321 }],
  errorRates: [],
  costByModel: [{ model: 'claude-sonnet-4-6', calls: 10, cost: 12.34, tokens: 9999 }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformDashboard (aggregate-only)', () => {
  beforeEach(() => {
    vi.mocked(studioApi.fetchPlatformStats).mockResolvedValue(STATS as never);
  });

  it('renders the aggregate sections from the mocked response', async () => {
    render(
      <MemoryRouter>
        <PlatformDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Platform Dashboard')).toBeInTheDocument());
    expect(screen.getByText('Task Completion')).toBeInTheDocument();
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('renders the project count instead of a "recent projects" list', async () => {
    render(
      <MemoryRouter>
        <PlatformDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Platform Dashboard')).toBeInTheDocument());
    expect(screen.getAllByText(/4242/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument();
    expect(screen.queryByText('Recently Completed Tasks')).not.toBeInTheDocument();
  });

  it('does not crash when the server omits recentProjects/recentTasks entirely', async () => {
    const { recentProjects: _p, recentTasks: _t, ...aggregatesOnly } = STATS;
    vi.mocked(studioApi.fetchPlatformStats).mockResolvedValue(aggregatesOnly as never);
    render(
      <MemoryRouter>
        <PlatformDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Platform Dashboard')).toBeInTheDocument());
    expect(screen.getAllByText(/4242/).length).toBeGreaterThan(0);
  });
});

describe('InsightDashboard (aggregate-only)', () => {
  beforeEach(() => {
    vi.mocked(studioApi.fetchPlatformAnalytics).mockResolvedValue(ANALYTICS as never);
  });

  it('renders the aggregate sections (agent usage, model usage, daily/hourly, complexity, event types)', async () => {
    render(
      <MemoryRouter>
        <InsightDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Agent Usage')).toBeInTheDocument());
    expect(screen.getByText('Model Usage')).toBeInTheDocument();
    expect(screen.getByText('Daily Activity')).toBeInTheDocument();
    expect(screen.getByText('Activity Hours')).toBeInTheDocument();
    expect(screen.getByText('Complexity Distribution')).toBeInTheDocument();
    expect(screen.getByText('Event Types')).toBeInTheDocument();
  });

  it('renders counts instead of the per-project "Project Focus" and per-file "Hot Files" lists', async () => {
    render(
      <MemoryRouter>
        <InsightDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Agent Usage')).toBeInTheDocument());
    expect(screen.queryByText('Project Focus')).not.toBeInTheDocument();
    expect(screen.queryByText('Hot Files')).not.toBeInTheDocument();
    expect(screen.getAllByText(/3737/).length).toBeGreaterThan(0); // total project count shown
  });

  it('does not crash when projectActivity/fileActivity/errorRates are omitted', async () => {
    const { projectActivity: _a, fileActivity: _f, errorRates: _e, ...aggregatesOnly } = ANALYTICS;
    vi.mocked(studioApi.fetchPlatformAnalytics).mockResolvedValue(aggregatesOnly as never);
    render(
      <MemoryRouter>
        <InsightDashboard />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Agent Usage')).toBeInTheDocument());
  });
});
