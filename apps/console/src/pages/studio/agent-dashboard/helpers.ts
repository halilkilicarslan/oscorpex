// ---------------------------------------------------------------------------
// Agent Dashboard Helpers
// ---------------------------------------------------------------------------

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}dk`;
  return `${(ms / 3600000).toFixed(1)}sa`;
}

export function formatTokenCount(count: number): string {
  if (!count) return '-';
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function rateColor(rate: number): string {
  if (rate >= 80) return 'text-[#22c55e]';
  if (rate >= 50) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}
