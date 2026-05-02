// ---------------------------------------------------------------------------
// useModalState — Generic modal open/close + selected item state
// Replaces the repeated editorOpen/editingTemplate/deleteTarget pattern.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';

export interface UseModalStateResult<T> {
	isOpen: boolean;
	selectedItem: T | null;
	open: (item?: T) => void;
	close: () => void;
}

export function useModalState<T = undefined>(): UseModalStateResult<T> {
	const [isOpen, setIsOpen] = useState(false);
	const [selectedItem, setSelectedItem] = useState<T | null>(null);

	const open = useCallback((item?: T) => {
		setSelectedItem(item ?? null);
		setIsOpen(true);
	}, []);

	const close = useCallback(() => {
		setIsOpen(false);
		setSelectedItem(null);
	}, []);

	return { isOpen, selectedItem, open, close };
}
