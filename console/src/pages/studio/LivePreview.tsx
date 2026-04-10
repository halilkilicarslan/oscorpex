import { useState, useEffect, useRef } from 'react';
import { Loader2, ExternalLink, RotateCcw, Maximize2, Minimize2, Smartphone, Monitor, Tablet, Settings2, Braces, Globe, Server } from 'lucide-react';
import { startApp, stopApp, fetchAppStatus, switchPreviewService, type AppStatus } from '../../lib/studio-api';
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
  const [showRuntime, setShowRuntime] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [isApiOnly, setIsApiOnly] = useState(false);
  const apiDetectedOnce = useRef(false);

  // Determine preview URL
  const services = appStatus.services || [];
  const activeService = selectedService
    ? services.find(s => s.name === selectedService)
    : services.find(s => s.isPreview) || services[0];
  const directUrl = activeService?.url || appStatus.previewUrl || appStatus.frontendUrl || appStatus.backendUrl;
  // Direct URL for iframe — proxy can't handle ES module imports in inline scripts
  const previewUrl = directUrl || null;
  // Proxy URL for API-only detection (avoids CORS on cross-origin fetch)
  const proxyUrl = directUrl ? `/api/studio/projects/${projectId}/app/proxy/` : null;

  // API-only detection: proxy root'u kontrol et (sadece ilk seferde viewMode ayarla)
  useEffect(() => {
    if (!proxyUrl || !appStatus.running) return;
    fetch(proxyUrl).then(res => {
      if (res.headers.get('content-type')?.includes('text/html')) {
        res.text().then(body => {
          if (body.includes('API-Only Application')) {
            setIsApiOnly(true);
            if (!apiDetectedOnce.current) {
              apiDetectedOnce.current = true;
              setViewMode('api');
            }
          } else {
            setIsApiOnly(false);
          }
        });
      } else {
        // JSON response = API endpoint, not a web app
        setIsApiOnly(true);
        if (!apiDetectedOnce.current) {
          apiDetectedOnce.current = true;
          setViewMode('api');
        }
      }
    }).catch(() => {});
  }, [proxyUrl, appStatus.running]);

  const handleSwitchService = async (serviceName: string) => {
    setSelectedService(serviceName);
    // Backend proxy hedefini değiştir
    await switchPreviewService(projectId, serviceName).catch(() => {});
    // API-only state'i resetle — yeni service'te tekrar algılansın
    apiDetectedOnce.current = false;
    setIsApiOnly(false);
    setViewMode('preview');
    setIframeKey(k => k + 1);
    // Kısa gecikme sonrası yeni hedefi kontrol et
    const detectUrl = `/api/studio/projects/${projectId}/app/proxy/`;
    setTimeout(() => {
      fetch(detectUrl).then(res => {
        if (res.headers.get('content-type')?.includes('text/html')) {
          res.text().then(body => {
            if (body.includes('API-Only Application')) {
              setIsApiOnly(true);
              setViewMode('api');
            }
          });
        } else {
          setIsApiOnly(true);
          setViewMode('api');
        }
        apiDetectedOnce.current = true;
      }).catch(() => {});
    }, 500);
  };

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
          {/* Service badges */}
          <div className="flex items-center gap-1">
            {services.map(s => (
              <button
                key={s.name}
                onClick={() => handleSwitchService(s.name)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                  s.name === activeService?.name
                    ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20'
                    : 'bg-[#1a1a1a] text-[#71717a] hover:text-[#a3a3a3] hover:bg-[#262626]'
                }`}
                title={s.url}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
                <Server size={9} />
                <span>{s.name}</span>
                <span className="text-[#525252]">{s.url.replace('http://localhost:', ':')}</span>
              </button>
            ))}
          </div>
          {isApiOnly && viewMode === 'preview' && (
            <span className="text-[10px] text-[#f59e0b] px-1.5 py-0.5 rounded bg-[#f59e0b]/10">API-only</span>
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
