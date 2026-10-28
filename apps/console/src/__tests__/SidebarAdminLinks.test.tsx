import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import * as authContext from '../contexts/AuthContext';

// F2 review: platform dashboards / insights / observability are platform-admin only on the server;
// the sidebar must not offer them to regular tenant users.

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const ADMIN_ONLY_HREFS = [
  '/studio/dashboard',
  '/studio/insights',
  '/dashboard',
  '/traces',
  '/logs',
  '/feedbacks',
  '/alerts',
];

function renderSidebar(user: Record<string, unknown>) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    user,
    isAuthenticated: true,
    logout: vi.fn(),
  } as never);
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

const hrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Sidebar — platform admin links', () => {
  it('hides dashboard / insights / observability links for non-admins', () => {
    const { container } = renderSidebar({ id: 'u1', email: 'a@b.c', isPlatformAdmin: false });
    const links = hrefs(container);
    for (const href of ADMIN_ONLY_HREFS) expect(links, href).not.toContain(href);
  });

  it('hides them when the flag is absent (treated as non-admin)', () => {
    const { container } = renderSidebar({ id: 'u1', email: 'a@b.c' });
    const links = hrefs(container);
    for (const href of ADMIN_ONLY_HREFS) expect(links, href).not.toContain(href);
  });

  it('keeps the regular tenant links for non-admins', () => {
    const { container } = renderSidebar({ id: 'u1', email: 'a@b.c', isPlatformAdmin: false });
    const links = hrefs(container);
    expect(links).toContain('/studio');
    expect(links).toContain('/studio/skills');
  });

  it('shows them for platform admins', () => {
    const { container } = renderSidebar({ id: 'u1', email: 'a@b.c', isPlatformAdmin: true });
    const links = hrefs(container);
    for (const href of ADMIN_ONLY_HREFS) expect(links, href).toContain(href);
  });
});
