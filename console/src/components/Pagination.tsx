import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
	currentPage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
	if (totalPages <= 1) return null;

	const isFirst = currentPage === 1;
	const isLast = currentPage === totalPages;

	return (
		<div className="flex items-center justify-center gap-3 mt-6">
			<button
				onClick={() => onPageChange(currentPage - 1)}
				disabled={isFirst}
				className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-[#262626] bg-[#1a1a1a] text-[#a3a3a3] hover:text-[#fafafa] hover:border-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
			>
				<ChevronLeft size={14} />
				Prev
			</button>

			<span className="text-[13px] text-[#737373] select-none">
				Page <span className="text-[#fafafa] font-medium">{currentPage}</span> of{' '}
				<span className="text-[#fafafa] font-medium">{totalPages}</span>
			</span>

			<button
				onClick={() => onPageChange(currentPage + 1)}
				disabled={isLast}
				className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-[#262626] bg-[#1a1a1a] text-[#a3a3a3] hover:text-[#fafafa] hover:border-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
			>
				Next
				<ChevronRight size={14} />
			</button>
		</div>
	);
}
