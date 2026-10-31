// Studio WebSocket address, shared by useStudioWebSocket and the pipeline output stream.
//   - VITE_STUDIO_WS_PORT set -> page hostname on that port (explicit override)
//   - dev build               -> page hostname on 3142 (kernel WS server)
//   - production build        -> same origin; the reverse proxy forwards /api/studio/ws

const DEV_WS_PORT = 3142;

export function studioWsUrl(): string {
  const { protocol: pageProtocol, hostname, host } = window.location;
  const protocol = pageProtocol === 'https:' ? 'wss' : 'ws';
  const explicit = import.meta.env.VITE_STUDIO_WS_PORT;
  if (explicit) return `${protocol}://${hostname || 'localhost'}:${explicit}/api/studio/ws`;
  if (import.meta.env.DEV) return `${protocol}://${hostname || 'localhost'}:${DEV_WS_PORT}/api/studio/ws`;
  return `${protocol}://${host}/api/studio/ws`;
}
