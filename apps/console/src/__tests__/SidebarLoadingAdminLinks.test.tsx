import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../components/Sidebar';
import * as authContext from '../contexts/AuthContext';

// F2 round 3 (item 7): while the user is still loading (user undefined, isLoading true) the sidebar must not
// flash admin-only links. Auth disabled (user undefined, loading finished) is the dev bypass and keeps them.

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

function renderSidebar(auth: Record<string, unknown>) {
  vi.mocked(authContext.useAuth).mockReturnValue({ logout: vi.fn(), ...auth } as never);
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

describe('Sidebar — admin links while the user is loading', () => {
  it('hides admin-only links when user is undefined and isLoading is true', () => {
    const { container } = renderSidebar({ user: undefined, isAuthenticated: false, isLoading: true });
    const links = hrefs(container);
    for (const href of ADMIN_ONLY_HREFS) expect(links, href).not.toContain(href);
  });

  it('hides admin-only links when user is null and isLoading is true', () => {
    const { container } = renderSidebar({ user: null, isAuthenticated: false, isLoading: true });
    const links = hrefs(container);
    for (const href of ADMIN_ONLY_HREFS) expect(links, href).not.toContain(href);
  });

  it('still renders the regular links while loading', () => {
    const { container } = renderSidebar({ user: undefined, isAuthenticated: false, isLoading: true });
    expect(hrefs(container)).toContain('/studio');
  });

  it('auth disabled (loading finished, no user) keeps the dev bypass: admin links shown', () => {
    const { container } = renderSidebar({ user: undefined, isAuthenticated: false, isLoading: false });
    const links = hrefs(container);
    for (const href of ADMIN_ONLY_HREFS) expect(links, href).toContain(href);
  });
});
