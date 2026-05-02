// ---------------------------------------------------------------------------
// AuthContext — JWT auth state management
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
	fetchCurrentUser,
	login as loginApi,
	register as registerApi,
	type AuthUser,
	type RegisterData,
} from '../lib/studio-api/auth';
import { StudioApiError } from '../lib/studio-api/base';

const TOKEN_KEY = 'oscorpex_token';

interface AuthContextValue {
	user: AuthUser | null;
	token: string | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	login: (email: string, password: string) => Promise<void>;
	register: (data: RegisterData) => Promise<void>;
	logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [token, setToken] = useState<string | null>(() => {
		try {
			return localStorage.getItem(TOKEN_KEY);
		} catch {
			return null;
		}
	});
	const [isLoading, setIsLoading] = useState(true);

	const [authDisabled, setAuthDisabled] = useState(false);

	// On mount: validate stored token or detect auth-disabled mode
	useEffect(() => {
		if (token) {
			fetchCurrentUser(token)
				.then((data) => {
					if ((data as any).authDisabled) {
						setAuthDisabled(true);
						return;
					}
					setUser(data);
				})
				.catch((err: unknown) => {
					// Keep session on transient/server/network errors.
					// Only clear token when backend explicitly says unauthorized/forbidden.
					if (err instanceof StudioApiError && (err.status === 401 || err.status === 403)) {
						try {
							localStorage.removeItem(TOKEN_KEY);
						} catch {
							// ignore
						}
						setToken(null);
					}
				})
				.finally(() => setIsLoading(false));
		} else {
			// No token: check if auth is disabled on the server
			fetchCurrentUser("")
				.then((data) => {
					if ((data as any).authDisabled) {
						setAuthDisabled(true);
					}
				})
				.catch(() => {
					// Auth endpoint failed — assume auth is enabled, stay logged out
				})
				.finally(() => setIsLoading(false));
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const persistToken = (t: string) => {
		try {
			localStorage.setItem(TOKEN_KEY, t);
		} catch {
			// ignore
		}
	};

	const clearToken = () => {
		try {
			localStorage.removeItem(TOKEN_KEY);
		} catch {
			// ignore
		}
	};

	const loginFn = useCallback(async (email: string, password: string) => {
		const res = await loginApi(email, password);
		persistToken(res.token);
		setToken(res.token);
		setUser(res.user);
	}, []);

	const registerFn = useCallback(async (data: RegisterData) => {
		const res = await registerApi(data);
		persistToken(res.token);
		setToken(res.token);
		setUser(res.user);
	}, []);

	const logout = useCallback(() => {
		clearToken();
		setToken(null);
		setUser(null);
	}, []);

	return (
		<AuthContext.Provider
			value={{
				user,
				token,
				isAuthenticated: authDisabled || !!token,
				isLoading,
				login: loginFn,
				register: registerFn,
				logout,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
