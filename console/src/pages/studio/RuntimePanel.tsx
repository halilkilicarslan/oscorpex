import { useState, useEffect, useCallback } from 'react';
import {
  Server, Database, Key, Package, Play, Square, Loader2,
  CheckCircle2, AlertTriangle, Globe, Container, HardDrive,
  Eye, EyeOff, ChevronDown, ChevronRight, Settings2,
} from 'lucide-react';
import {
  analyzeRuntime, saveEnvVars, provisionDb, stopDb, installDeps, startApp, fetchAppStatus,
  type RuntimeAnalysis, type EnvVarRequirement,
  type DatabaseType, type DbProvisionMethod, type AppStatus,
} from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Framework ikonları ve renkleri
// ---------------------------------------------------------------------------

const FRAMEWORK_META: Record<string, { label: string; color: string }> = {
  express:        { label: 'Express.js',   color: '#22c55e' },
  hono:           { label: 'Hono',         color: '#ff6b35' },
  fastify:        { label: 'Fastify',      color: '#000000' },
  koa:            { label: 'Koa',          color: '#33333d' },
  nestjs:         { label: 'NestJS',       color: '#e0234e' },
  nextjs:         { label: 'Next.js',      color: '#000000' },
  nuxt:           { label: 'Nuxt',         color: '#00dc82' },
  vite:           { label: 'Vite',         color: '#646cff' },
  cra:            { label: 'Create React', color: '#61dafb' },
  angular:        { label: 'Angular',      color: '#dd0031' },
  django:         { label: 'Django',       color: '#092e20' },
  fastapi:        { label: 'FastAPI',      color: '#009688' },
  flask:          { label: 'Flask',        color: '#000000' },
  'spring-boot':  { label: 'Spring Boot',  color: '#6db33f' },
  go:             { label: 'Go',           color: '#00add8' },
  gin:            { label: 'Gin',          color: '#00add8' },
  rails:          { label: 'Rails',        color: '#cc0000' },
  'rust-actix':   { label: 'Rust/Actix',   color: '#dea584' },
  'rust-axum':    { label: 'Rust/Axum',    color: '#dea584' },
  'generic-node': { label: 'Node.js',      color: '#339933' },
  'generic-python': { label: 'Python',     color: '#3776ab' },
  unknown:        { label: 'Unknown',      color: '#666' },
};

const DB_META: Record<DatabaseType, { label: string; color: string; icon: string }> = {
  postgresql: { label: 'PostgreSQL', color: '#336791', icon: '🐘' },
  mysql:      { label: 'MySQL',      color: '#4479a1', icon: '🐬' },
  mongodb:    { label: 'MongoDB',    color: '#47a248', icon: '🍃' },
  redis:      { label: 'Redis',      color: '#dc382d', icon: '⚡' },
  sqlite:     { label: 'SQLite',     color: '#003b57', icon: '📦' },
};

const CATEGORY_LABELS: Record<string, string> = {
  database: 'Veritabani',
  auth: 'Kimlik Dogrulama',
  api: 'API Anahtarlari',
  app: 'Uygulama',
  other: 'Diger',
};

// ---------------------------------------------------------------------------
// Bileşen
// ---------------------------------------------------------------------------

export default function RuntimePanel({
  projectId,
  onAppStarted,
}: {
  projectId: string;
  onAppStarted?: (status: AppStatus) => void;
}) {
  const [analysis, setAnalysis] = useState<RuntimeAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    services: true, databases: true, env: true,
  });
  const [dbMethod, setDbMethod] = useState<Record<string, DbProvisionMethod>>({});
  const [cloudUrls, setCloudUrls] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<{ type: 'success' | 'error' | 'info'; text: string }[]>([]);

  const addMessage = (type: 'success' | 'error' | 'info', text: string) => {
    setMessages(prev => [...prev.slice(-4), { type, text }]);
    if (type !== 'error') setTimeout(() => setMessages(prev => prev.slice(1)), 5000);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await analyzeRuntime(projectId);
      setAnalysis(data);
      // Mevcut env var default'larını doldur
      const defaults: Record<string, string> = {};
      for (const v of data.envVars) {
        if (v.defaultValue) defaults[v.key] = v.defaultValue;
      }
      setEnvValues(prev => ({ ...defaults, ...prev }));
      // DB method defaults
      const methods: Record<string, DbProvisionMethod> = {};
      for (const db of data.databases) {
        methods[db.type] = 'docker';
      }
      setDbMethod(prev => ({ ...methods, ...prev }));
    } catch (err) {
      addMessage('error', 'Analiz baslatilamadi');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // -- Actions --

  const handleSaveEnv = async () => {
    setActionLoading('env');
    try {
      // Sadece dolu olan değerleri gönder
      const filled = Object.fromEntries(
        Object.entries(envValues).filter(([, v]) => v.trim().length > 0),
      );
      await saveEnvVars(projectId, filled);
      addMessage('success', '.env dosyasi guncellendi');
      await load();
    } catch {
      addMessage('error', '.env kaydedilemedi');
    }
    setActionLoading(null);
  };

  const handleInstallDeps = async (serviceName?: string) => {
    setActionLoading(serviceName ? `install-${serviceName}` : 'install-all');
    try {
      const result = await installDeps(projectId, serviceName);
      const failed = result.results.filter(r => !r.success);
      if (failed.length > 0) {
        addMessage('error', `Kurulum basarisiz: ${failed.map(f => f.name).join(', ')}`);
      } else {
        addMessage('success', 'Bagimliliklar kuruldu');
      }
      await load();
    } catch {
      addMessage('error', 'Kurulum hatasi');
    }
    setActionLoading(null);
  };

  const handleProvisionDb = async (dbType: DatabaseType) => {
    const method = dbMethod[dbType] || 'docker';
    setActionLoading(`db-${dbType}`);
    try {
      const result = await provisionDb(
        projectId, dbType, method,
        method === 'cloud' ? cloudUrls[dbType] : undefined,
      );
      if (result.ok) {
        addMessage('success', `${DB_META[dbType].label} baslatildi`);
        await load();
      }
    } catch (err: any) {
      addMessage('error', err?.message || `${dbType} baslatilamadi`);
    }
    setActionLoading(null);
  };

  const handleStopDb = async (dbType: DatabaseType) => {
    setActionLoading(`db-stop-${dbType}`);
    try {
      await stopDb(projectId, dbType);
      addMessage('info', `${DB_META[dbType].label} durduruldu`);
      await load();
    } catch {
      addMessage('error', `${dbType} durdurulamadi`);
    }
    setActionLoading(null);
  };

  const handleStartApp = async () => {
    setActionLoading('start-app');
    try {
      const result = await startApp(projectId);
      const status = await fetchAppStatus(projectId);
      addMessage('success', `${result.services?.length || 0} servis baslatildi`);
      onAppStarted?.(status);
    } catch (err: any) {
      addMessage('error', err?.message || 'Uygulama baslatilamadi');
    }
    setActionLoading(null);
  };

  // -- Render --

  if (loading && !analysis) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[#a1a1aa]">
        <Loader2 size={18} className="animate-spin" /> Proje analiz ediliyor...
      </div>
    );
  }

  if (!analysis) return null;

  const groupedEnv = analysis.envVars.reduce<Record<string, EnvVarRequirement[]>>((acc, v) => {
    (acc[v.category] ??= []).push(v);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Messages */}
      {messages.length > 0 && (
        <div className="space-y-1">
          {messages.map((m, i) => (
            <div key={i} className={`text-xs px-3 py-1.5 rounded ${
              m.type === 'success' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
              m.type === 'error' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
              'bg-[#3b82f6]/10 text-[#3b82f6]'
            }`}>
              {m.text}
            </div>
          ))}
        </div>
      )}

      {/* ---- Services ---- */}
      <Section
        title="Servisler"
        icon={<Server size={15} />}
        expanded={expandedSections.services}
        onToggle={() => toggleSection('services')}
        badge={analysis.services.length > 0 ? String(analysis.services.length) : undefined}
      >
        {analysis.services.length === 0 ? (
          <div className="text-xs text-[#71717a] py-2">
            Calistirilabilir servis bulunamadi. Proje dizinini kontrol edin.
          </div>
        ) : (
          <div className="space-y-2">
            {analysis.services.map((svc) => {
              const meta = FRAMEWORK_META[svc.framework] || FRAMEWORK_META.unknown;
              return (
                <div key={svc.name} className="bg-[#18181b] rounded-lg border border-[#27272a] p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                      <span className="text-sm font-medium text-[#fafafa]">{svc.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#a1a1aa]">
                        {meta.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#71717a]">
                        :{svc.port}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {svc.depsInstalled ? (
                        <span className="text-[10px] text-[#22c55e] flex items-center gap-1">
                          <CheckCircle2 size={10} /> Deps OK
                        </span>
                      ) : (
                        <button
                          onClick={() => handleInstallDeps(svc.name)}
                          disabled={actionLoading === `install-${svc.name}`}
                          className="text-[10px] px-2 py-0.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 flex items-center gap-1"
                        >
                          {actionLoading === `install-${svc.name}` ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
                          Kur
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-[#71717a] font-mono truncate">
                    $ {svc.startCommand}
                  </div>
                </div>
              );
            })}

            {/* Install All + Start */}
            <div className="flex gap-2 pt-1">
              {!analysis.allDepsInstalled && (
                <button
                  onClick={() => handleInstallDeps()}
                  disabled={!!actionLoading}
                  className="flex-1 text-xs px-3 py-1.5 rounded bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/20 flex items-center justify-center gap-1.5"
                >
                  {actionLoading === 'install-all' ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                  Tum Bagimliliklari Kur
                </button>
              )}
              <button
                onClick={handleStartApp}
                disabled={!!actionLoading}
                className="flex-1 text-xs px-3 py-2 rounded bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 flex items-center justify-center gap-1.5 font-medium"
              >
                {actionLoading === 'start-app' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Uygulamayi Baslat
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* ---- Databases ---- */}
      {analysis.databases.length > 0 && (
        <Section
          title="Veritabanlari"
          icon={<Database size={15} />}
          expanded={expandedSections.databases}
          onToggle={() => toggleSection('databases')}
          badge={String(analysis.databases.length)}
        >
          <div className="space-y-2">
            {analysis.databases.map((db) => {
              const meta = DB_META[db.type];
              const status = analysis.dbStatuses?.find(s => s.type === db.type);
              const isRunning = status?.running;
              const method = dbMethod[db.type] || 'docker';

              return (
                <div key={db.type} className="bg-[#18181b] rounded-lg border border-[#27272a] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{meta.icon}</span>
                      <span className="text-sm font-medium text-[#fafafa]">{meta.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272a] text-[#71717a]">
                        :{db.port}
                      </span>
                    </div>
                    {isRunning && (
                      <span className="text-[10px] text-[#22c55e] flex items-center gap-1">
                        <CheckCircle2 size={10} /> Calisiyor
                      </span>
                    )}
                  </div>

                  {/* Method seçici */}
                  <div className="flex gap-1">
                    {(['docker', 'local', 'cloud'] as DbProvisionMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setDbMethod(prev => ({ ...prev, [db.type]: m }))}
                        className={`text-[10px] px-2 py-0.5 rounded flex items-center gap-1 ${
                          method === m
                            ? 'bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30'
                            : 'bg-[#27272a] text-[#71717a] hover:text-[#a1a1aa]'
                        }`}
                      >
                        {m === 'docker' && <Container size={9} />}
                        {m === 'local' && <HardDrive size={9} />}
                        {m === 'cloud' && <Globe size={9} />}
                        {m === 'docker' ? 'Docker' : m === 'local' ? 'Local' : 'Cloud'}
                      </button>
                    ))}
                  </div>

                  {/* Cloud URL input */}
                  {method === 'cloud' && (
                    <input
                      type="text"
                      placeholder={`${db.type}://user:pass@host:port/dbname`}
                      value={cloudUrls[db.type] || ''}
                      onChange={(e) => setCloudUrls(prev => ({ ...prev, [db.type]: e.target.value }))}
                      className="w-full text-xs px-2 py-1.5 rounded bg-[#09090b] border border-[#27272a] text-[#fafafa] placeholder-[#52525b] font-mono"
                    />
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-1.5">
                    {!isRunning ? (
                      <button
                        onClick={() => handleProvisionDb(db.type)}
                        disabled={actionLoading === `db-${db.type}`}
                        className="text-[10px] px-2.5 py-1 rounded bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 flex items-center gap-1"
                      >
                        {actionLoading === `db-${db.type}` ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                        Baslat
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStopDb(db.type)}
                        disabled={actionLoading === `db-stop-${db.type}`}
                        className="text-[10px] px-2.5 py-1 rounded bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 flex items-center gap-1"
                      >
                        {actionLoading === `db-stop-${db.type}` ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
                        Durdur
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ---- Environment Variables ---- */}
      <Section
        title="Ortam Degiskenleri"
        icon={<Key size={15} />}
        expanded={expandedSections.env}
        onToggle={() => toggleSection('env')}
        badge={analysis.envVars.length > 0 ? String(analysis.envVars.length) : undefined}
        status={analysis.allEnvVarsSet ? 'ok' : analysis.envVars.some(v => v.required) ? 'warning' : undefined}
      >
        {analysis.envVars.length === 0 ? (
          <div className="text-xs text-[#71717a] py-2">
            .env.example bulunamadi. Env var gereksinimleri otomatik algilanamadi.
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(groupedEnv).map(([category, vars]) => (
              <div key={category}>
                <div className="text-[10px] text-[#71717a] uppercase tracking-wide mb-1.5">
                  {CATEGORY_LABELS[category] || category}
                </div>
                <div className="space-y-1.5">
                  {vars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-[11px] text-[#a1a1aa] font-mono w-[180px] truncate flex items-center gap-1">
                        {v.required && <span className="text-[#ef4444]">*</span>}
                        {v.key}
                      </label>
                      <div className="flex-1 relative">
                        <input
                          type={v.sensitive && !showSensitive[v.key] ? 'password' : 'text'}
                          value={envValues[v.key] || ''}
                          onChange={(e) => setEnvValues(prev => ({ ...prev, [v.key]: e.target.value }))}
                          placeholder={v.description || v.defaultValue || ''}
                          className="w-full text-xs px-2 py-1 rounded bg-[#09090b] border border-[#27272a] text-[#fafafa] placeholder-[#3f3f46] font-mono pr-7"
                        />
                        {v.sensitive && (
                          <button
                            onClick={() => setShowSensitive(prev => ({ ...prev, [v.key]: !prev[v.key] }))}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#52525b] hover:text-[#a1a1aa]"
                          >
                            {showSensitive[v.key] ? <EyeOff size={11} /> : <Eye size={11} />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button
              onClick={handleSaveEnv}
              disabled={actionLoading === 'env'}
              className="w-full text-xs px-3 py-1.5 rounded bg-[#3b82f6]/10 text-[#3b82f6] hover:bg-[#3b82f6]/20 flex items-center justify-center gap-1.5"
            >
              {actionLoading === 'env' ? <Loader2 size={12} className="animate-spin" /> : <Settings2 size={12} />}
              .env Kaydet
            </button>
          </div>
        )}
      </Section>

      {/* ---- Quick Status ---- */}
      <div className="bg-[#18181b] rounded-lg border border-[#27272a] p-3">
        <div className="text-[10px] text-[#71717a] uppercase tracking-wide mb-2">Durum Ozeti</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <StatusItem
            label="Bagimliliklar"
            ok={analysis.allDepsInstalled}
            text={analysis.allDepsInstalled ? 'Kurulu' : 'Eksik'}
          />
          <StatusItem
            label="Env Var"
            ok={analysis.allEnvVarsSet}
            text={analysis.allEnvVarsSet ? 'Tamam' : 'Eksik'}
          />
          <StatusItem
            label="Veritabani"
            ok={analysis.dbReady || analysis.databases.length === 0}
            text={analysis.databases.length === 0 ? 'Gerekmiyor' : analysis.dbReady ? 'Hazir' : 'Bekliyor'}
          />
          <StatusItem
            label="Config"
            ok={analysis.hasStudioConfig}
            text={analysis.hasStudioConfig ? '.studio.json' : analysis.hasDockerCompose ? 'Docker' : 'Auto-detect'}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alt bilesenler
// ---------------------------------------------------------------------------

function Section({
  title, icon, expanded, onToggle, badge, status, children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
  status?: 'ok' | 'warning';
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#0a0a0b] rounded-lg border border-[#27272a]">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#18181b] rounded-t-lg"
      >
        <div className="flex items-center gap-2 text-sm text-[#fafafa]">
          {icon}
          {title}
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#27272a] text-[#a1a1aa]">{badge}</span>
          )}
          {status === 'ok' && <CheckCircle2 size={12} className="text-[#22c55e]" />}
          {status === 'warning' && <AlertTriangle size={12} className="text-[#f59e0b]" />}
        </div>
        {expanded ? <ChevronDown size={14} className="text-[#71717a]" /> : <ChevronRight size={14} className="text-[#71717a]" />}
      </button>
      {expanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function StatusItem({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? <CheckCircle2 size={11} className="text-[#22c55e]" /> : <AlertTriangle size={11} className="text-[#f59e0b]" />}
      <span className="text-[#a1a1aa]">{label}:</span>
      <span className={ok ? 'text-[#22c55e]' : 'text-[#f59e0b]'}>{text}</span>
    </div>
  );
}
