/// <reference types="node" />
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom + undici/Node.js surum uyumsuzlugundan kaynaklanan WebSocket
// ERR_INVALID_ARG_TYPE hatasini sessizce yoksay.
// Bu hata test koduyla ilgisiz; EventFeed gibi SSE/WebSocket kullanan
// bilesenler unmount sonrasi arka planda baglanti kapatmaya calistiginda
// undici'nin kendi ic Event dispatch mekanizmasinda ortaya cikiyor.
process.on('uncaughtException', (err: Error) => {
  if (
    (err as NodeJS.ErrnoException).code === 'ERR_INVALID_ARG_TYPE' &&
    err.message.includes('"event" argument')
  ) {
    return; // sessizce yoksay
  }
  throw err;
});

// Mock localStorage for jsdom — guards all window.localStorage access in tests
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});
