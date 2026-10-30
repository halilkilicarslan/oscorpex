import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LivePreview from '../pages/studio/LivePreview';

// F3-0: the preview iframe loads the app's own URL (a different origin from the console),
// so allow-same-origin only applies to the app's origin — never the console's. It must
// still never be allowed to navigate the top window.

vi.mock('../lib/studio-api', () => ({
  detectApiOnlyPreview: vi.fn().mockResolvedValue(false),
  fetchAppStatus: vi.fn().mockResolvedValue({ running: true }),
  fetchTasks: vi.fn().mockResolvedValue([]),
  stopApp: vi.fn().mockResolvedValue(undefined),
  switchPreviewService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../pages/studio/ApiExplorer', () => ({ default: () => null }));
vi.mock('../pages/studio/RuntimePanel', () => ({ default: () => null }));

const mockFetch = vi.fn();

describe('LivePreview iframe sandbox (F3-0)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ cwd: '', exists: false }),
    } as Response);
    vi.stubGlobal('fetch', mockFetch);
  });

  function renderPreview() {
    const appStatus = {
      running: true,
      previewUrl: 'http://localhost:4100',
      services: [],
    } as never;
    return render(<LivePreview projectId="p1" appStatus={appStatus} onStatusChange={() => {}} />);
  }

  const sandboxTokens = (container: HTMLElement) =>
    (container.querySelector('iframe')?.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean);

  it('loads the direct preview URL, not the kernel proxy', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src).toBe('http://localhost:4100');
    expect(src).not.toContain('/app/proxy');
  });

  it('sandbox allows scripts and same-origin (own origin) with forms and popups', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    const tokens = sandboxTokens(container);
    expect(tokens).toContain('allow-scripts');
    expect(tokens).toContain('allow-same-origin');
    expect(tokens).toContain('allow-forms');
    expect(tokens).toContain('allow-popups');
  });

  it('sandbox does NOT allow top navigation', async () => {
    const { container } = renderPreview();
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(sandboxTokens(container)).not.toContain('allow-top-navigation');
  });
});
