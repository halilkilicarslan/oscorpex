import { useState } from 'react';
import { TagPill } from './TagPill.js';

interface TagInputProps {
	tags: string[];
	onChange: (tags: string[]) => void;
}

export function TagInput({ tags, onChange }: TagInputProps) {
	const [input, setInput] = useState('');

	const addTag = () => {
		const trimmed = input.trim().toLowerCase().replace(/\s+/g, '-');
		if (trimmed && !tags.includes(trimmed)) {
			onChange([...tags, trimmed]);
		}
		setInput('');
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTag();
		} else if (e.key === 'Backspace' && !input && tags.length > 0) {
			onChange(tags.slice(0, -1));
		}
	};

	return (
		<div className="min-h-[38px] bg-[#0d0d0d] border border-[#262626] rounded-lg px-3 py-2 flex flex-wrap gap-1.5 focus-within:border-[#333]">
			{tags.map((t) => (
				<TagPill key={t} tag={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
			))}
			<input
				type="text"
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={handleKeyDown}
				onBlur={addTag}
				placeholder={tags.length === 0 ? 'Add tags...' : ''}
				className="flex-1 min-w-[80px] bg-transparent text-[12px] text-[#a3a3a3] placeholder-[#3a3a3a] focus:outline-none"
			/>
		</div>
	);
}
