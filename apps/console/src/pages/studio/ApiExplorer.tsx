import { useState, useEffect, useCallback } from 'react';
import {
  Search, Send, Trash2, ChevronRight, ChevronDown, Loader2,
  Copy, Check, Clock, FileJson, Code2, Globe,
} from 'lucide-react';
import {
  discoverApiRoutes, loadApiCollection, saveApiRequest, deleteApiRequest,
  sendProxyRequest,
  type HttpMethod, type DiscoveredRoute, type ApiDiscoveryResult, type SavedRequest,
} from '../../lib/studio-api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-[#22c55e] bg-[#22c55e]/10',
  POST: 'text-[#3b82f6] bg-[#3b82f6]/10',
  PUT: 'text-[#f59e0b] bg-[#f59e0b]/10',
  PATCH: 'text-[#a855f7] bg-[#a855f7]/10',
  DELETE: 'text-[#ef4444] bg-[#ef4444]/10',
};

const STATUS_COLORS: Record<string, string> = {
  '2': 'text-[#22c55e]',
  '3': 'text-[#3b82f6]',
  '4': 'text-[#f59e0b]',
  '5': 'text-[#ef4444]',
};

function statusColor(status: number): string {
  return STATUS_COLORS[String(status)[0]] || 'text-[#737373]';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApiExplorer({ projectId }: { projectId: string }) {
  // Discovery
  const [discovery, setDiscovery] = useState<ApiDiscoveryResult | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // Collection (saved requests)
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);

  // Current request
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('');
  const [reqHeaders, setReqHeaders] = useState('');
  const [reqBody, setReqBody] = useState('');
  const [activeTab, setActiveTab] = useState<'headers' | 'body'>('body');

  // Response
  const [response, setResponse] = useState<{
    status: number; headers: Record<string, string>; body: string; duration: number;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  // UI state
  const [routesOpen, setRoutesOpen] = useState(true);
  const [collectionOpen, setCollectionOpen] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [methodOpen, setMethodOpen] = useState(false);
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');

  // --- Load discovery + collection ---
  useEffect(() => {
    setDiscovering(true);
    Promise.all([
      discoverApiRoutes(projectId),
      loadApiCollection(projectId),
    ]).then(([disc, coll]) => {
      setDiscovery(disc);
      setSavedRequests(coll.requests);
      // İlk route varsa path'e yaz
      if (disc.routes.length > 0 && !path) {
        const first = disc.routes[0];
        setMethod(first.method);
        const fullPath = first.path.startsWith(disc.basePath) ? first.path : disc.basePath + first.path;
        setPath(fullPath);
      }
    }).finally(() => setDiscovering(false));
  }, [projectId]);

  // --- Send request ---
  const handleSend = useCallback(async () => {
    if (!path.trim()) return;
    setSending(true);
    setResponse(null);
    try {
      let headers: Record<string, string> | undefined;
      if (reqHeaders.trim()) {
        try { headers = JSON.parse(reqHeaders); } catch { /* ignore */ }
      }
      const res = await sendProxyRequest(projectId, method, path, headers, reqBody || undefined);
      setResponse(res);

      // Koleksiyona kaydet
      const id = `${method}:${path}`;
      const now = new Date().toISOString();
      const saved: SavedRequest = {
        id,
        method,
        path,
        headers,
        body: reqBody || undefined,
        lastStatus: res.status,
        lastResponse: res.body.slice(0, 1000),
        lastDuration: res.duration,
        createdAt: savedRequests.find(r => r.id === id)?.createdAt || now,
        updatedAt: now,
      };
      await saveApiRequest(projectId, saved);
      setSavedRequests(prev => {
        const idx = prev.findIndex(r => r.id === id);
        if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
        return [...prev, saved];
      });
    } catch { /* ignore */ }
    setSending(false);
  }, [projectId, method, path, reqHeaders, reqBody, savedRequests]);

  // --- Select route ---
  const selectRoute = (route: DiscoveredRoute) => {
    const basePath = discovery?.basePath || '';
    // Route path zaten basePath ile başlıyorsa tekrar ekleme
    const fullPath = route.path.startsWith(basePath) ? route.path : basePath + route.path;
    setMethod(route.method);
    setPath(fullPath);
    setResponse(null);
  };

  const selectSaved = (req: SavedRequest) => {
    setMethod(req.method);
    setPath(req.path);
    setReqBody(req.body || '');
    if (req.headers) setReqHeaders(JSON.stringify(req.headers, null, 2));
    setResponse(null);
  };

  const handleDelete = async (id: string) => {
    await deleteApiRequest(projectId, id);
    setSavedRequests(prev => prev.filter(r => r.id !== id));
  };

  const copyResponse = () => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Filter routes
  const filteredRoutes = discovery?.routes.filter(r =>
    !searchFilter || r.path.toLowerCase().includes(searchFilter.toLowerCase()) ||
    r.method.toLowerCase().includes(searchFilter.toLowerCase())
  ) || [];

  // Pretty-print JSON
  const formatBody = (text: string): string => {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  };

  return (
    <div className="flex h-full bg-[#0a0a0a]">
      {/* ─── Left Panel: Routes + Collection ─── */}
      <div className="w-[280px] shrink-0 border-r border-[#262626] flex flex-col overflow-hidden">
        {/* Search */}
        <div className="p-2 border-b border-[#262626]">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#111111] border border-[#262626]">
            <Search size={12} className="text-[#525252] shrink-0" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Endpoint ara..."
              className="flex-1 bg-transparent text-[11px] text-[#e5e5e5] outline-none placeholder-[#525252]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Discovered Routes */}
          <div className="border-b border-[#262626]">
            <button
              onClick={() => setRoutesOpen(!routesOpen)}
              className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] text-[#737373] uppercase tracking-wider hover:bg-[#111111]"
            >
              {routesOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Routes
              {discovering && <Loader2 size={10} className="animate-spin ml-auto" />}
              {!discovering && discovery && (
                <span className="ml-auto text-[#525252]">{discovery.routes.length}</span>
              )}
            </button>

            {routesOpen && (
              <div className="pb-1">
                {discovery?.discoveryMethod && discovery.discoveryMethod !== 'none' && (
                  <div className="px-3 py-1 text-[10px] text-[#525252] flex items-center gap-1">
                    {discovery.discoveryMethod === 'openapi' && <><FileJson size={10} /> OpenAPI</>}
                    {discovery.discoveryMethod === 'source-parse' && <><Code2 size={10} /> Source Parse</>}
                    {discovery.discoveryMethod === 'probe' && <><Globe size={10} /> Probe</>}
                    {discovery.basePath && <span className="text-[#3b82f6]">{discovery.basePath}</span>}
                  </div>
                )}
                {filteredRoutes.map((route, i) => (
                  <button
                    key={`${route.method}:${route.path}:${i}`}
                    onClick={() => selectRoute(route)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-[#111111] transition-colors group"
                  >
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLORS[route.method]}`}>
                      {route.method}
                    </span>
                    <span className="text-[11px] text-[#a3a3a3] truncate flex-1 font-mono">
                      {route.path}
                    </span>
                  </button>
                ))}
                {!discovering && filteredRoutes.length === 0 && (
                  <div className="px-3 py-3 text-[11px] text-[#525252] text-center">
                    Route bulunamadi
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Saved Collection */}
          <div>
            <button
              onClick={() => setCollectionOpen(!collectionOpen)}
              className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] text-[#737373] uppercase tracking-wider hover:bg-[#111111]"
            >
              {collectionOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Koleksiyon
              <span className="ml-auto text-[#525252]">{savedRequests.length}</span>
            </button>

            {collectionOpen && savedRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#111111] transition-colors group cursor-pointer"
                onClick={() => selectSaved(req)}
              >
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLORS[req.method]}`}>
                  {req.method}
                </span>
                <span className="text-[11px] text-[#a3a3a3] truncate flex-1 font-mono">
                  {req.path}
                </span>
                {req.lastStatus && (
                  <span className={`text-[10px] ${statusColor(req.lastStatus)}`}>
                    {req.lastStatus}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(req.id); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-[#525252] hover:text-red-400 transition-all"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Right Panel: Request / Response ─── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Request Bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#262626] bg-[#111111]">
          {/* Method selector */}
          <div className="relative">
            <button
              onClick={() => setMethodOpen(!methodOpen)}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg ${METHOD_COLORS[method]} min-w-[60px] text-center`}
            >
              {method}
            </button>
            {methodOpen && (
              <div className="absolute top-full mt-1 left-0 bg-[#1a1a1a] border border-[#262626] rounded-lg shadow-xl z-10 py-1">
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map(m => (
                  <button
                    key={m}
                    onClick={() => { setMethod(m); setMethodOpen(false); }}
                    className={`block w-full text-left px-3 py-1 text-[11px] font-bold hover:bg-[#262626] ${METHOD_COLORS[m]}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Path input */}
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="/api/v1/endpoint"
            className="flex-1 bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-1.5 text-[12px] text-[#e5e5e5] font-mono outline-none focus:border-[#3b82f6] transition-colors placeholder-[#525252]"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={sending || !path.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#3b82f6] text-white text-[11px] font-medium hover:bg-[#2563eb] transition-colors disabled:opacity-40"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Gonder
          </button>
        </div>

        {/* Request Options */}
        <div className="border-b border-[#262626]">
          <div className="flex items-center gap-0 px-3">
            {(['body', 'headers'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-[11px] border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-[#3b82f6] text-[#e5e5e5]'
                    : 'border-transparent text-[#525252] hover:text-[#a3a3a3]'
                }`}
              >
                {tab === 'body' ? 'Body' : 'Headers'}
              </button>
            ))}
          </div>

          <div className="px-3 py-2" style={{ minHeight: '60px' }}>
            {activeTab === 'body' ? (
              <textarea
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
                placeholder='{ "key": "value" }'
                className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[11px] text-[#e5e5e5] font-mono outline-none resize-none placeholder-[#525252] focus:border-[#262626]"
                rows={3}
              />
            ) : (
              <textarea
                value={reqHeaders}
                onChange={(e) => setReqHeaders(e.target.value)}
                placeholder='{ "Authorization": "Bearer ..." }'
                className="w-full bg-[#0a0a0a] border border-[#262626] rounded-lg px-3 py-2 text-[11px] text-[#e5e5e5] font-mono outline-none resize-none placeholder-[#525252] focus:border-[#262626]"
                rows={3}
              />
            )}
          </div>
        </div>

        {/* Response */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {response ? (
            <>
              {/* Response header */}
              <div className="flex items-center gap-3 px-3 py-2 border-b border-[#262626] bg-[#111111]">
                <span className="text-[11px] font-medium text-[#a3a3a3]">Response</span>
                <span className={`text-[12px] font-bold ${statusColor(response.status)}`}>
                  {response.status}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-[#525252]">
                  <Clock size={10} />
                  {response.duration}ms
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {(['body', 'headers'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setResponseTab(tab)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        responseTab === tab
                          ? 'bg-[#262626] text-[#e5e5e5]'
                          : 'text-[#525252] hover:text-[#a3a3a3]'
                      }`}
                    >
                      {tab === 'body' ? 'Body' : `Headers (${Object.keys(response.headers).length})`}
                    </button>
                  ))}
                  <button
                    onClick={copyResponse}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1a1a1a] transition-colors ml-1"
                  >
                    {copied ? <Check size={10} className="text-[#22c55e]" /> : <Copy size={10} />}
                    {copied ? 'Kopyalandi' : 'Kopyala'}
                  </button>
                </div>
              </div>

              {/* Response content */}
              <div className="flex-1 overflow-auto p-3">
                {responseTab === 'body' ? (
                  <pre className="text-[11px] text-[#e5e5e5] font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {formatBody(response.body)}
                  </pre>
                ) : (
                  <div className="space-y-0.5">
                    {Object.entries(response.headers).map(([key, val]) => (
                      <div key={key} className="flex gap-2 text-[11px] font-mono py-0.5">
                        <span className="text-[#3b82f6] shrink-0">{key}:</span>
                        <span className="text-[#a3a3a3] break-all">{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#525252]">
              <div className="text-center">
                <Send size={24} className="mx-auto mb-2 opacity-30" />
                <p className="text-[12px]">Bir endpoint secin veya URL girin</p>
                <p className="text-[10px] mt-1">Enter veya Gonder butonuyla istek gonderin</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
