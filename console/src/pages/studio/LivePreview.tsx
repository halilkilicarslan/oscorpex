import { useState } from 'react';
import { Play, Loader2, ExternalLink, RotateCcw, Maximize2, Minimize2, Smartphone, Monitor, Tablet, ChevronDown } from 'lucide-react';
import { startApp, stopApp, fetchAppStatus, type AppStatus } from '../../lib/studio-api';

type DeviceSize = 'mobile' | 'tablet' | 'desktop';

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

  // Determine preview URL: selected service > previewUrl > backward compat
  const services = appStatus.services || [];
  const activeService = selectedService
    ? services.find(s => s.name === selectedService)
    : services.find(s => s.isPreview) || services[0];
  const previewUrl = activeService?.url || appStatus.previewUrl || appStatus.frontendUrl || appStatus.backendUrl;

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

  // App not running — start screen
  if (!appStatus.running || !previewUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#22c55e]/10 flex items-center justify-center">
          <Play size={32} className="text-[#22c55e] ml-1" />
        </div>
        <div className="text-center">
          <h3 className="text-[14px] font-medium text-[#a3a3a3] mb-1">Live Preview</h3>
          <p className="text-[12px] text-[#525252] max-w-sm">
            Uygulamayı başlatarak canlı önizleme yapabilirsiniz.
          </p>
        </div>
        <button
          onClick={handleStart}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#22c55e] text-[#0a0a0a] font-medium text-[13px] hover:bg-[#16a34a] disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} />
          )}
          {loading ? 'Başlatılıyor...' : 'Uygulamayı Başlat'}
        </button>
      </div>
    );
  }

  // App running — iframe preview
  return (
    <div className={`flex flex-col h-full ${fullscreen ? 'fixed inset-0 z-50 bg-[#0a0a0a]' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#262626] bg-[#111111] shrink-0">
        <div className="flex items-center gap-1">
          {/* Device size buttons */}
          {(Object.entries(DEVICE_SIZES) as [DeviceSize, typeof DEVICE_SIZES.mobile][]).map(([key, val]) => (
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

          {/* Service selector — only show if multiple services */}
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
              <span className="truncate max-w-[200px]">{previewUrl}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
            title="Yenile"
          >
            <RotateCcw size={14} />
          </button>
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
            title="Yeni sekmede aç"
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors"
            title={fullscreen ? 'Küçült' : 'Tam ekran'}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
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

      {/* iframe */}
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
    </div>
  );
}
