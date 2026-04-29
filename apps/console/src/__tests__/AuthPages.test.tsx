import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// ---------------------------------------------------------------------------
// Mock: studio-api/auth
// ---------------------------------------------------------------------------
vi.mock('../lib/studio-api/auth', () => ({
	login: vi.fn(),
	register: vi.fn(),
	fetchCurrentUser: vi.fn(),
}));

import * as authApi from '../lib/studio-api/auth';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import LoginPage from '../pages/auth/LoginPage';
import RegisterPage from '../pages/auth/RegisterPage';
import { ProtectedRoute } from '../components/ProtectedRoute';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER: authApi.AuthUser = {
	id: 'user-1',
	email: 'test@example.com',
	displayName: 'Test User',
	tenantId: 'tenant-1',
	role: 'admin',
};

const MOCK_LOGIN_RESPONSE: authApi.LoginResponse = {
	token: 'jwt-test-token',
	user: MOCK_USER,
};

function renderWithRouter(
	ui: React.ReactElement,
	{ initialEntries = ['/'] }: { initialEntries?: string[] } = {},
) {
	return render(
		<MemoryRouter initialEntries={initialEntries}>
			<AuthProvider>{ui}</AuthProvider>
		</MemoryRouter>,
	);
}

// Mock localStorage
const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
	};
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage', () => {
	beforeEach(() => {
		localStorageMock.clear();
		vi.clearAllMocks();
		// fetchCurrentUser resolves to null by default (no stored token)
		vi.mocked(authApi.fetchCurrentUser).mockRejectedValue(new Error('Not authenticated'));
	});

	it('renders email, password fields and submit button', async () => {
		renderWithRouter(<LoginPage />, { initialEntries: ['/login'] });

		await waitFor(() => {
			expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
		});
	});

	it('successful login navigates to /studio', async () => {
		vi.mocked(authApi.login).mockResolvedValue(MOCK_LOGIN_RESPONSE);

		render(
			<MemoryRouter initialEntries={['/login']}>
				<AuthProvider>
					<Routes>
						<Route path="/login" element={<LoginPage />} />
						<Route path="/studio" element={<div>Studio Page</div>} />
					</Routes>
				</AuthProvider>
			</MemoryRouter>,
		);

		const user = userEvent.setup();

		await waitFor(() => screen.getByLabelText(/email/i));

		await user.type(screen.getByLabelText(/email/i), 'test@example.com');
		await user.type(screen.getByLabelText(/password/i), 'password123');
		await user.click(screen.getByRole('button', { name: /sign in/i }));

		await waitFor(() => {
			expect(screen.getByText('Studio Page')).toBeInTheDocument();
		});
	});

	it('failed login shows error message', async () => {
		vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid credentials'));

		renderWithRouter(<LoginPage />, { initialEntries: ['/login'] });

		const user = userEvent.setup();

		await waitFor(() => screen.getByLabelText(/email/i));

		await user.type(screen.getByLabelText(/email/i), 'bad@example.com');
		await user.type(screen.getByLabelText(/password/i), 'wrongpass');
		await user.click(screen.getByRole('button', { name: /sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
		});
	});

	it('renders register link', async () => {
		renderWithRouter(<LoginPage />, { initialEntries: ['/login'] });

		await waitFor(() => {
			expect(screen.getByRole('link', { name: /register/i })).toBeInTheDocument();
		});
	});
});

describe('RegisterPage', () => {
	beforeEach(() => {
		localStorageMock.clear();
		vi.clearAllMocks();
		vi.mocked(authApi.fetchCurrentUser).mockRejectedValue(new Error('Not authenticated'));
	});

	it('renders registration form fields', async () => {
		renderWithRouter(<RegisterPage />, { initialEntries: ['/register'] });

		await waitFor(() => {
			expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
		});
	});

	it('successful registration navigates to /studio', async () => {
		vi.mocked(authApi.register).mockResolvedValue(MOCK_LOGIN_RESPONSE);

		render(
			<MemoryRouter initialEntries={['/register']}>
				<AuthProvider>
					<Routes>
						<Route path="/register" element={<RegisterPage />} />
						<Route path="/studio" element={<div>Studio Page</div>} />
					</Routes>
				</AuthProvider>
			</MemoryRouter>,
		);

		const user = userEvent.setup();

		await waitFor(() => screen.getByLabelText(/email/i));

		await user.type(screen.getByLabelText(/email/i), 'new@example.com');
		await user.type(screen.getByLabelText(/password/i), 'password123');
		await user.click(screen.getByRole('button', { name: /create account/i }));

		await waitFor(() => {
			expect(screen.getByText('Studio Page')).toBeInTheDocument();
		});
	});

	it('shows error for short password (client-side validation)', async () => {
		renderWithRouter(<RegisterPage />, { initialEntries: ['/register'] });

		const user = userEvent.setup();

		await waitFor(() => screen.getByLabelText(/email/i));

		await user.type(screen.getByLabelText(/email/i), 'test@example.com');
		await user.type(screen.getByLabelText(/password/i), 'short');
		await user.click(screen.getByRole('button', { name: /create account/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i);
		});
	});

	it('renders sign-in link', async () => {
		renderWithRouter(<RegisterPage />, { initialEntries: ['/register'] });

		await waitFor(() => {
			expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
		});
	});
});

describe('ProtectedRoute', () => {
	beforeEach(() => {
		localStorageMock.clear();
		vi.clearAllMocks();
		vi.mocked(authApi.fetchCurrentUser).mockRejectedValue(new Error('Not authenticated'));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('renders children when authenticated and auth is enabled', async () => {
		// Store a token so AuthProvider picks it up
		localStorageMock.setItem('oscorpex_token', 'valid-token');
		vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(MOCK_USER);
		vi.stubEnv('VITE_AUTH_ENABLED', 'true');

		render(
			<MemoryRouter initialEntries={['/studio']}>
				<AuthProvider>
					<Routes>
						<Route
							path="/studio"
							element={
								<ProtectedRoute>
									<div>Protected Content</div>
								</ProtectedRoute>
							}
						/>
					</Routes>
				</AuthProvider>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Protected Content')).toBeInTheDocument();
		});
	});

	it('redirects to /login when not authenticated and auth is enabled', async () => {
		vi.stubEnv('VITE_AUTH_ENABLED', 'true');

		render(
			<MemoryRouter initialEntries={['/studio']}>
				<AuthProvider>
					<Routes>
						<Route
							path="/studio"
							element={
								<ProtectedRoute>
									<div>Protected Content</div>
								</ProtectedRoute>
							}
						/>
						<Route path="/login" element={<div>Login Page</div>} />
					</Routes>
				</AuthProvider>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Login Page')).toBeInTheDocument();
		});
	});

	it('renders children when auth is not enabled (backward compat)', async () => {
		vi.stubEnv('VITE_AUTH_ENABLED', 'false');
		localStorageMock.setItem('oscorpex_token', 'stored-token');
		vi.mocked(authApi.fetchCurrentUser).mockResolvedValueOnce(MOCK_USER);

		render(
			<MemoryRouter initialEntries={['/studio']}>
				<AuthProvider>
					<Routes>
						<Route
							path="/studio"
							element={
								<ProtectedRoute>
									<div>Protected Content</div>
								</ProtectedRoute>
							}
						/>
					</Routes>
				</AuthProvider>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Protected Content')).toBeInTheDocument();
		});
	});
});

// ---------------------------------------------------------------------------
// AuthContext unit tests
// ---------------------------------------------------------------------------

function AuthConsumer() {
	const { user, isAuthenticated, login, logout, register } = useAuth();
	return (
		<div>
			<span data-testid="authenticated">{String(isAuthenticated)}</span>
			<span data-testid="email">{user?.email ?? 'none'}</span>
			<button onClick={() => login('a@b.com', 'pass1234')}>login</button>
			<button onClick={() => register({ email: 'a@b.com', password: 'pass1234' })}>register</button>
			<button onClick={logout}>logout</button>
		</div>
	);
}

describe('AuthContext', () => {
	beforeEach(() => {
		localStorageMock.clear();
		vi.clearAllMocks();
		vi.mocked(authApi.fetchCurrentUser).mockRejectedValue(new Error('Not authenticated'));
	});

	it('login stores token in localStorage', async () => {
		vi.mocked(authApi.login).mockResolvedValue(MOCK_LOGIN_RESPONSE);

		render(
			<MemoryRouter>
				<AuthProvider>
					<AuthConsumer />
				</AuthProvider>
			</MemoryRouter>,
		);

		const user = userEvent.setup();

		await waitFor(() => screen.getByTestId('authenticated'));

		await user.click(screen.getByRole('button', { name: 'login' }));

		await waitFor(() => {
			expect(localStorageMock.getItem('oscorpex_token')).toBe('jwt-test-token');
			expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
		});
	});

	it('logout removes token from localStorage', async () => {
		vi.mocked(authApi.login).mockResolvedValue(MOCK_LOGIN_RESPONSE);

		render(
			<MemoryRouter>
				<AuthProvider>
					<AuthConsumer />
				</AuthProvider>
			</MemoryRouter>,
		);

		const user = userEvent.setup();

		await user.click(screen.getByRole('button', { name: 'login' }));
		await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));

		await user.click(screen.getByRole('button', { name: 'logout' }));

		await waitFor(() => {
			expect(localStorageMock.getItem('oscorpex_token')).toBeNull();
			expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
		});
	});

	it('initial load with stored token fetches current user', async () => {
		localStorageMock.setItem('oscorpex_token', 'stored-token');
		vi.mocked(authApi.fetchCurrentUser).mockResolvedValue(MOCK_USER);

		render(
			<MemoryRouter>
				<AuthProvider>
					<AuthConsumer />
				</AuthProvider>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('email')).toHaveTextContent('test@example.com');
			expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
		});

		expect(authApi.fetchCurrentUser).toHaveBeenCalledWith('stored-token');
	});

	it('invalid stored token clears auth state', async () => {
		localStorageMock.setItem('oscorpex_token', 'bad-token');
		vi.mocked(authApi.fetchCurrentUser).mockRejectedValue(new Error('Not authenticated'));

		render(
			<MemoryRouter>
				<AuthProvider>
					<AuthConsumer />
				</AuthProvider>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
			expect(localStorageMock.getItem('oscorpex_token')).toBeNull();
		});
	});
});
