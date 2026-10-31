// D4 — the studio WebSocket address comes from ONE shared helper (`studioWsUrl`), used by both
// useStudioWebSocket.ts and pipeline.ts:
//   - VITE_STUDIO_WS_PORT set  -> `${proto}://${location.hostname}:${port}/api/studio/ws` (dev override)
//   - dev build, no override   -> port 3142 (today's behaviour)
//   - production build         -> same origin as the page (nginx proxies /api/studio/ws), no extra port
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studioWsUrl } from '../lib/studio-api/ws-url';

const realLocation = window.location;

function setLocation(href: string): void {
  const u = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, origin: u.origin },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  // A developer's local apps/console/.env may set the override; each case starts without it.
  vi.stubEnv('VITE_STUDIO_WS_PORT', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('studioWsUrl', () => {
  it('explicit VITE_STUDIO_WS_PORT: keeps hostname:port (in dev and in prod)', () => {
    setLocation('http://example.test:5161/studio');
    for (const dev of [true, false]) {
      vi.stubEnv('DEV', dev);
      vi.stubEnv('PROD', !dev);
      vi.stubEnv('VITE_STUDIO_WS_PORT', '4000');
      expect(studioWsUrl()).toBe('ws://example.test:4000/api/studio/ws');
    }
  });

  it('explicit port under https uses wss', () => {
    setLocation('https://example.test/studio');
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_STUDIO_WS_PORT', '4443');
    expect(studioWsUrl()).toBe('wss://example.test:4443/api/studio/ws');
  });

  it('DEV without override: default port 3142 on the page hostname', () => {
    setLocation('http://localhost:5161/');
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    expect(studioWsUrl()).toBe('ws://localhost:3142/api/studio/ws');
  });

  it('production, http: same origin (page host incl. its own port), no 3142', () => {
    setLocation('http://console.example.test/dashboard');
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    expect(studioWsUrl()).toBe('ws://console.example.test/api/studio/ws');
    expect(studioWsUrl()).not.toContain('3142');
  });

  it('production, https: wss on the same origin, no port', () => {
    setLocation('https://console.example.test/dashboard');
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    expect(studioWsUrl()).toBe('wss://console.example.test/api/studio/ws');
  });

  it('production, page on a non-default port: only the page own port, never 3142', () => {
    setLocation('http://localhost:5161/');
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    expect(studioWsUrl()).toBe('ws://localhost:5161/api/studio/ws');
  });

  it('result is a valid URL that accepts a ticket query parameter', () => {
    setLocation('https://console.example.test/');
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const u = new URL(studioWsUrl());
    u.searchParams.set('ticket', 'abc');
    expect(u.toString()).toBe('wss://console.example.test/api/studio/ws?ticket=abc');
  });
});

describe('call sites use the shared helper', () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

  it.each(['hooks/useStudioWebSocket.ts', 'lib/studio-api/pipeline.ts'])('%s imports studioWsUrl and has no own port logic', (f) => {
    const code = src(f);
    expect(code).toMatch(/import[^;]*\bstudioWsUrl\b[^;]*from\s+['"][^'"]*ws-url(\.js)?['"]/);
    expect(code).toMatch(/studioWsUrl\(/);
    expect(code).not.toMatch(/VITE_STUDIO_WS_PORT/);
    expect(code).not.toMatch(/3142/);
  });
});
