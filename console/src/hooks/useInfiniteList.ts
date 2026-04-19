import { useState, useEffect, useCallback, useRef } from 'react';
import type { PaginatedResult } from '../lib/studio-api/index.js';

interface UseInfiniteListOptions<T> {
	fetchFn: (limit: number, offset: number) => Promise<PaginatedResult<T>>;
	pageSize?: number;
	enabled?: boolean;
}

interface UseInfiniteListResult<T> {
	items: T[];
	total: number;
	hasMore: boolean;
	isLoading: boolean;
	loadMore: () => void;
	refresh: () => void;
}

export function useInfiniteList<T>({
	fetchFn,
	pageSize = 50,
	enabled = true,
}: UseInfiniteListOptions<T>): UseInfiniteListResult<T> {
	const [items, setItems] = useState<T[]>([]);
	const [total, setTotal] = useState(0);
	const [offset, setOffset] = useState(0);
	const [isLoading, setIsLoading] = useState(false);

	// Stable ref to fetchFn to avoid effect re-runs on inline arrow functions
	const fetchFnRef = useRef(fetchFn);
	fetchFnRef.current = fetchFn;

	const fetchPage = useCallback(async (currentOffset: number, replace: boolean) => {
		setIsLoading(true);
		try {
			const result = await fetchFnRef.current(pageSize, currentOffset);
			setTotal(result.total);
			setItems((prev) => (replace ? result.data : [...prev, ...result.data]));
		} catch {
			// silently ignore fetch errors
		} finally {
			setIsLoading(false);
		}
	}, [pageSize]);

	// Initial fetch when enabled
	useEffect(() => {
		if (!enabled) return;
		setItems([]);
		setTotal(0);
		setOffset(0);
		fetchPage(0, true);
	}, [enabled, fetchPage]);

	const loadMore = useCallback(() => {
		if (isLoading) return;
		const nextOffset = offset + pageSize;
		setOffset(nextOffset);
		fetchPage(nextOffset, false);
	}, [isLoading, offset, pageSize, fetchPage]);

	const refresh = useCallback(() => {
		setItems([]);
		setTotal(0);
		setOffset(0);
		fetchPage(0, true);
	}, [fetchPage]);

	const hasMore = items.length < total;

	return { items, total, hasMore, isLoading, loadMore, refresh };
}
