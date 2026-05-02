// ---------------------------------------------------------------------------
// useTableData — Generic data fetching hook with pagination and search
// Wraps the repeated useState+useCallback+useEffect pattern found across
// PromptsPage, TriggersPage, RagPage, FeedbacksPage, TracesPage.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseTableDataOptions<T> {
	fetchFn: (params: { offset: number; limit: number; search?: string }) => Promise<{ items: T[]; total: number }>;
	pageSize?: number;
	initialSearch?: string;
	/**
	 * Extra dependencies that should trigger a re-fetch when changed.
	 * Pass a stable array (useMemo or module-level constant) to avoid
	 * infinite loops — the hook does a shallow-equal check on the ref.
	 */
	deps?: unknown[];
}

export interface UseTableDataResult<T> {
	items: T[];
	total: number;
	isLoading: boolean;
	error: string | null;
	search: string;
	setSearch: (s: string) => void;
	page: number;
	setPage: (p: number) => void;
	pageSize: number;
	totalPages: number;
	refresh: () => void;
}

export function useTableData<T>({
	fetchFn,
	pageSize = 50,
	initialSearch = '',
	deps = [],
}: UseTableDataOptions<T>): UseTableDataResult<T> {
	const [items, setItems] = useState<T[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearchRaw] = useState(initialSearch);
	const [page, setPageRaw] = useState(0);

	// Keep a stable ref to deps so the effect below doesn't need it in the
	// dependency array while still reacting when the values change.
	const depsRef = useRef(deps);
	// Stringify for cheap equality — deps are expected to be primitive-ish
	const depsKey = JSON.stringify(deps);

	useEffect(() => {
		depsRef.current = deps;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [depsKey]);

	// Stable fetch wrapper — recreated only when fetchFn, pageSize, page or
	// search changes (not on every deps array identity change).
	const load = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const offset = page * pageSize;
			const result = await fetchFn({ offset, limit: pageSize, search: search || undefined });
			setItems(result.items);
			setTotal(result.total);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, [fetchFn, page, pageSize, search]);

	// Re-run on load fn change OR when deps change
	useEffect(() => {
		void load();
		// depsKey drives re-fetch when external filters change
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [load, depsKey]);

	// Reset to page 0 when search changes
	const setSearch = useCallback((s: string) => {
		setPageRaw(0);
		setSearchRaw(s);
	}, []);

	// Reset to page 0 when page setter is used externally with 0
	const setPage = useCallback((p: number) => {
		setPageRaw(p);
	}, []);

	const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;

	return {
		items,
		total,
		isLoading,
		error,
		search,
		setSearch,
		page,
		setPage,
		pageSize,
		totalPages,
		refresh: load,
	};
}
