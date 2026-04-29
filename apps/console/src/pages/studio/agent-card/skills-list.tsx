interface SkillsListProps {
	skills: string[];
}

export default function SkillsList({ skills }: SkillsListProps) {
	if (skills.length === 0) return null;

	return (
		<div className="px-4 pb-3 flex flex-wrap gap-1">
			{skills.slice(0, 4).map((skill) => (
				<span
					key={skill}
					className="text-[10px] px-1.5 py-0.5 rounded bg-[#1f1f1f] text-[#737373] border border-[#262626]"
				>
					{skill}
				</span>
			))}
			{skills.length > 4 && (
				<span className="text-[10px] px-1.5 py-0.5 text-[#525252]">+{skills.length - 4}</span>
			)}
		</div>
	);
}
