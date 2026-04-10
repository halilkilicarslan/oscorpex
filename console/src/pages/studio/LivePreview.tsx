import { useState, useEffect } from 'react';
import { Play, Loader2, ExternalLink, RotateCcw, Maximize2, Minimize2, Smartphone, Monitor, Tablet, ChevronDown, Settings2, Braces, Globe } from 'lucide-react';
import { startApp, stopApp, fetchAppStatus, type AppStatus } from '../../lib/studio-api';
import RuntimePanel from './RuntimePanel';
import ApiExplorer from './ApiExplorer';

type DeviceSize = 'mobile' | 'tablet' | 'desktop';
type ViewMode = 'preview' | 'api';

const DEVICE_SIZES: Record<DeviceSize, { width: string; label: string; icon: React.ReactNode }> = {
  mobile: { width: '375px', label: 'Mobile', icon: <Smartphone size={14} /> },
  tablet: { width: '768px', label: 'Tablet', icon: <Tablet size={14} /> },
  desktop: { width: '100%', label: 'Desktop', icon: <Monitor size={14} /> },
};

export default function LivePreview({
  projectId,
  appStatus,
  onStatusChange,
}: {
  projectId: string;
  appStatus: AppStatus;
  onStatusChange: (status: AppStatus) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<DeviceSize>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [serviceMenuOpen, setServiceMenuOpen] = useState(false);
  const [showRuntime, setShowRuntime] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [isApiOnly, setIsApiOnly] = useState(false);

  // Determine preview URL
  const services = appStatus.services || [];
  const activeService = selectedService
    ? services.find(s => s.name === selectedService)
    : services.find(s => s.isPreview) || services[0];
  const directUrl = activeService?.url || appStatus.previewUrl || appStatus.frontendUrl || appStatus.backendUrl;
  const previewUrl = directUrl ? `/api/studio/projects/${projectId}/app/proxy/` : null;

  // API-only detection: proxy root'u kontrol et
  useEffect(() => {
    if (!previewUrl || !appStatus.running) return;
    fetch(previewUrl).then(res => {
      // Proxy'den gelen response: API-only ise root 404 → proxy HTML info page döner
      // ama content-type text/html ise ve "API-Only" içeriyorsa → API-only
      if (res.headers.get('content-type')?.includes('text/html')) {
        res.text().then(body => {
          if (body.includes('API-Only Application')) {
            setIsApiOnly(true);
            setViewMode('api');
          } else {
            setIsApiOnly(false);
          }
        });
      } else {
        // JSON response = API endpoint, not a web app
        setIsApiOnly(true);
        setViewMode('api');
      }
    }).catch(() => {});
  }, [previewUrl, appStatus.running, iframeKey]);

  const handleStart = async () => {
    setLoading(true);
    try {
      await startApp(projectId);
      const status = await fetchAppStatus(projectId);
      onStatusChange(status);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await stopApp(projectId);
      const status = await fetchAppStatus(projectId);
      onStatusChange(status);
    } catch { /* ignore */ }
    setLoading(false);
  };

  // App not running — RuntimePanel
  if (!appStatus.running || !previewUrl) {
    return (
      <RuntimePanel
        projectId={projectId}
        onAppStarted={(status) => onStatusChange(status)}
      />
    );
  }

  // App running
  return (
    <div className={`flex flex-col h-full ${fullscreen ? 'fixed inset-0 z-50 bg-[#0a0a0a]' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#262626] bg-[#111111] shrink-0">
        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <div className="flex items-center bg-[#0a0a0a] rounded-lg p-0.5 mr-2">
            <button
              onClick={() => setViewMode('preview')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${
                viewMode === 'preview'
                  ? 'bg-[#1a1a1a] text-[#e5e5e5]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <Globe size={12} />
              Preview
            </button>
            <button
              onClick={() => setViewMode('api')}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${
                viewMode === 'api'
                  ? 'bg-[#3b82f6]/10 text-[#3b82f6]'
                  : 'text-[#525252] hover:text-[#a3a3a3]'
              }`}
            >
              <Braces size={12} />
              API Explorer
            </button>
          </div>

          {/* Device size — only for preview mode */}
          {viewMode === 'preview' && (Object.entries(DEVICE_SIZES) as [DeviceSize, typeof DEVICE_SIZES.mobile][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setDevice(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                device === key
                  ? 'bg-[#22c55e]/10 text-[#22c55e]'
                  : 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a]'
              }`}
            >
              {val.icon}
              {val.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[#525252]">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            {services.length > 1 ? `${services.length} services` : 'Running'}
          </span>

          {services.length > 1 ? (
            <div className="relative">
              <button
                onClick={() => setServiceMenuOpen(!serviceMenuOpen)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#1a1a1a] text-[#a3a3a3] hover:bg-[#262626] transition-colors"
              >
                <span className="truncate max-w-[120px]">{activeService?.name || 'Select'}</span>
                <ChevronDown size={10} />
              </button>
              {serviceMenuOpen && (
                <div className="absolute top-full mt-1 right-0 bg-[#1a1a1a] border border-[#262626] rounded-lg shadow-xl z-10 py-1 min-w-[160px]">
                  {services.map(s => (
                    <button
                      key={s.name}
                      onClick={() => {
                        setSelectedService(s.name);
                        setServiceMenuOpen(false);
                        setIframeKey(k => k + 1);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#262626] transition-colors flex items-center justify-between ${
                        s.name === activeService?.name ? 'text-[#22c55e]' : 'text-[#a3a3a3]'
                      }`}
                    >
                      <span>{s.name}</span>
                      <span className="text-[#525252]">{s.url.replace('http://localhost:', ':')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <span className="text-[#262626]">|</span>
              <span className="truncate max-w-[200px]">{directUrl}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {viewMode === 'preview' && (
            <button
              onClick={() => setIframeKey((k) => k + 1)}
              className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
              title="Yenile"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <a
            href={directUrl || '#'}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
            title="Yeni sekmede ac"
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
            title={fullscreen ? 'Kucult' : 'Tam ekran'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={() => setShowRuntime(r => !r)}
            className={`p-1.5 rounded-lg transition-colors ${
              showRuntime ? 'text-[#3b82f6] bg-[#3b82f6]/10' : 'text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a]'
            }`}
            title="Runtime Ayarlari"
          >
            <Settings2 size={14} />
          </button>
          <button
            onClick={handleStop}
            disabled={loading}
            className="ml-1 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            Durdur
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Runtime side panel */}
        {showRuntime && (
          <div className="w-[340px] shrink-0 border-r border-[#262626] bg-[#0a0a0a] overflow-auto">
            <RuntimePanel projectId={projectId} onAppStarted={onStatusChange} />
          </div>
        )}

        {/* Main content: Preview or API Explorer */}
        {viewMode === 'api' ? (
          <ApiExplorer projectId={projectId} />
        ) : (
          <div className="flex-1 flex items-start justify-center overflow-auto bg-[#0a0a0a] p-4">
            <div
              className="h-full bg-white rounded-lg overflow-hidden shadow-2xl transition-all duration-300"
              style={{ width: DEVICE_SIZES[device].width, maxWidth: '100%' }}
            >
              <iframe
                key={iframeKey}
                src={previewUrl}
                className="w-full h-full border-0"
                title="Live Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
