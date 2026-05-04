import { categoryClass } from './types.js';

export function CategoryBadge({ category }: { category: string }) {
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${categoryClass(category)}`}>
			{category}
		</span>
	);
}
