import { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Database,
  Gauge,
  Loader2,
  RefreshCw,
  Shield,
  Timer,
  Zap,
  Power,
  PowerOff,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  fetchPerformanceConfig,
  fetchProviderStatus,
  fetchProviders,
  updateProvider,
  type PerformanceConfigSnapshot,
  type PerformanceFeatureFlags,
  type ProviderRuntimeState,
  type AIProvider,
} from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(0)}m`;
}

function FeatureBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
        enabled
          ? 'border-[#22c55e]/20 bg-[#22c55e]/10 text-[#22c55e]'
          : 'border-[#ef4444]/20 bg-[#ef4444]/10 text-[#ef4444]'
      }`}
    >
      {enabled ? <Zap size={10} /> : <Shield size={10} />}
      {label}
    </span>
  );
}

function ConfigCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#262626] bg-[#111111] p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#fafafa]">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[11px]">
      <span className="text-[#525252]">{label}</span>
      <span className="font-mono text-[#a3a3a3]">{value}</span>
    </div>
  );
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      {active ? (
        <CheckCircle2 size={12} className="text-[#22c55e]" />
      ) : (
        <XCircle size={12} className="text-[#ef4444]" />
      )}
      <span className={active ? 'text-[#a3a3a3]' : 'text-[#525252]'}>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminSettingsPage() {
  const [config, setConfig] = useState<PerformanceConfigSnapshot | null>(null);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [runtimeStates, setRuntimeStates] = useState<ProviderRuntimeState[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cfgData, provData, statusData] = await Promise.all([
        fetchPerformanceConfig(),
        fetchProviders(),
        fetchProviderStatus(),
      ]);
      setConfig(cfgData.config);
      setProviders(provData);
      setRuntimeStates(statusData);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const toggleProvider = async (provider: AIProvider) => {
    setTogglingId(provider.id);
    try {
      await updateProvider(provider.id, { isActive: !provider.isActive });
      setProviders((prev) =>
        prev.map((p) => (p.id === provider.id ? { ...p, isActive: !p.isActive } : p)),
      );
    } catch {
      // silently fail
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#525252]" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[#737373]">
        <Activity size={32} className="text-[#333]" />
        <p className="text-[14px]">Failed to load configuration</p>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-[#a3a3a3] hover:border-[#333] hover:text-[#fafafa]"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  const features = Object.entries(config.features) as [keyof PerformanceFeatureFlags, boolean][];

  const runtimeMap = new Map(runtimeStates.map((s) => [s.adapter, s]));

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0a0a0a] p-6 text-[#fafafa]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Admin Settings</h1>
          <p className="mt-1 text-[13px] text-[#737373]">
            Runtime performance configuration, provider health, and feature flags.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2 text-[12px] text-[#a3a3a3] hover:border-[#333] hover:text-[#fafafa]"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {/* Feature flags */}
      <ConfigCard title="Feature Flags" icon={<Zap size={14} className="text-[#22c55e]" />}>
        <div className="flex flex-wrap gap-2">
          {features.map(([key, enabled]) => (
            <FeatureBadge key={key} enabled={enabled} label={key} />
          ))}
        </div>
        <p className="mt-3 text-[10px] text-[#525252]">
          Flags are read-only in the UI. Change via OSCORPEX_PERF_FEATURES env var.
        </p>
      </ConfigCard>

      {/* Provider Status */}
      <div className="mt-4">
        <ConfigCard title="Provider Runtime Status" icon={<Activity size={14} className="text-[#f59e0b]" />}>
          <div className="space-y-2">
            {providers.length === 0 && (
              <p className="text-[11px] text-[#525252]">No providers configured.</p>
            )}
            {providers.map((provider) => {
              const runtime = runtimeMap.get(provider.cliTool || provider.type);
              const inCooldown = runtime?.cooldownUntil ? new Date(runtime.cooldownUntil) > new Date() : false;
              return (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] font-medium text-[#fafafa]">{provider.name}</span>
                    <span className="text-[10px] text-[#525252]">
                      {provider.type} {provider.cliTool ? `· ${provider.cliTool}` : ''}
                    </span>
                    <div className="mt-1 flex items-center gap-3">
                      <StatusDot active={provider.isActive} label={provider.isActive ? 'Active' : 'Inactive'} />
                      {runtime && (
                        <StatusDot active={!inCooldown && !runtime.rateLimited} label={inCooldown ? 'Cooldown' : runtime.rateLimited ? 'Rate Limited' : 'Healthy'} />
                      )}
                      {runtime && runtime.consecutiveFailures > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#ef4444]">
                          <AlertTriangle size={10} />
                          {runtime.consecutiveFailures} failures
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleProvider(provider)}
                    disabled={togglingId === provider.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                      provider.isActive
                        ? 'border-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/10'
                        : 'border-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/10'
                    }`}
                  >
                    {togglingId === provider.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : provider.isActive ? (
                      <PowerOff size={12} />
                    ) : (
                      <Power size={12} />
                    )}
                    {provider.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              );
            })}
          </div>
        </ConfigCard>
      </div>

      {/* Config grid */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ConfigCard title="Adaptive Concurrency" icon={<Cpu size={14} className="text-[#3b82f6]" />}>
          <ConfigRow label="Default max" value={String(config.adaptiveConcurrency.defaultMax)} />
          <ConfigRow label="Adjustment interval" value={formatDuration(config.adaptiveConcurrency.adjustmentIntervalMs)} />
          <ConfigRow label="Failure threshold" value={`${config.adaptiveConcurrency.failureRateThreshold * 100}%`} />
          <ConfigRow label="Queue depth threshold" value={String(config.adaptiveConcurrency.queueDepthThreshold)} />
        </ConfigCard>

        <ConfigCard title="Retry Policy" icon={<RefreshCw size={14} className="text-[#f59e0b]" />}>
          <ConfigRow label="Max auto-retries" value={String(config.retryPolicy.maxAutoRetries)} />
          <ConfigRow label="Base backoff" value={formatDuration(config.retryPolicy.baseBackoffMs)} />
        </ConfigCard>

        <ConfigCard title="Timeout Policy" icon={<Timer size={14} className="text-[#ef4444]" />}>
          <ConfigRow label="S tier" value={formatDuration(config.timeoutPolicy.complexityBaseMs.S)} />
          <ConfigRow label="M tier" value={formatDuration(config.timeoutPolicy.complexityBaseMs.M)} />
          <ConfigRow label="L tier" value={formatDuration(config.timeoutPolicy.complexityBaseMs.L)} />
          <ConfigRow label="XL tier" value={formatDuration(config.timeoutPolicy.complexityBaseMs.XL)} />
        </ConfigCard>

        <ConfigCard title="Cooldown" icon={<Shield size={14} className="text-[#a855f7]" />}>
          <ConfigRow label="Unavailable" value={formatDuration(config.cooldown.durationsMs.unavailable)} />
          <ConfigRow label="Spawn failure" value={formatDuration(config.cooldown.durationsMs.spawn_failure)} />
          <ConfigRow label="Repeated timeout" value={formatDuration(config.cooldown.durationsMs.repeated_timeout)} />
        </ConfigCard>

        <ConfigCard title="Database Pool" icon={<Database size={14} className="text-[#10b981]" />}>
          <ConfigRow label="Min connections" value={String(config.dbPool.minConnections)} />
          <ConfigRow label="Max connections" value={String(config.dbPool.maxConnections)} />
          <ConfigRow label="Idle timeout" value={formatDuration(config.dbPool.idleTimeoutMs)} />
          <ConfigRow label="Acquire timeout" value={formatDuration(config.dbPool.acquireTimeoutMs)} />
        </ConfigCard>

        <ConfigCard title="Provider Multipliers" icon={<Gauge size={14} className="text-[#06b6d4]" />}>
          {Object.entries(config.timeoutPolicy.providerMultipliers).map(([provider, multiplier]) => (
            <ConfigRow key={provider} label={provider} value={`${multiplier}x`} />
          ))}
        </ConfigCard>
      </div>

      {/* Env var hint */}
      <div className="mt-6 rounded-2xl border border-[#262626] bg-[#111111] p-4">
        <div className="mb-2 text-[12px] font-medium text-[#fafafa]">Environment Variables</div>
        <div className="space-y-1 font-mono text-[11px] text-[#525252]">
          <p>OSCORPEX_PERF_FEATURES=&quot;adaptiveConcurrency,retryPolicy&quot;</p>
          <p>OSCORPEX_MAX_CONCURRENT_TASKS=3</p>
          <p>OSCORPEX_BASE_BACKOFF_MS=5000</p>
          <p>OSCORPEX_DB_POOL_MAX=20</p>
        </div>
        <p className="mt-2 text-[10px] text-[#404040]">
          Restart the kernel to apply environment variable changes.
        </p>
      </div>
    </div>
  );
}
