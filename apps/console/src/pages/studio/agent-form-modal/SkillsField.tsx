import { X, FileText } from 'lucide-react';
import type { ProjectAgent } from "../../../lib/studio-api";

interface SkillsFieldProps {
	skills: string[];
	skillInput: string;
	skillsMode: 'inline' | 'file';
	skillsMdContent: string;
	agent?: ProjectAgent;
	labelClass: string;
	inputClass: string;
	onSkillInputChange: (value: string) => void;
	onAddSkill: () => void;
	onRemoveSkill: (skill: string) => void;
	onToggleMode: () => void;
	onMdContentChange: (value: string) => void;
	onLoadFile: () => void;
	onSaveFile: () => void;
}

export default function SkillsField({
	skills,
	skillInput,
	skillsMode,
	skillsMdContent,
	agent,
	labelClass,
	inputClass,
	onSkillInputChange,
	onAddSkill,
	onRemoveSkill,
	onToggleMode,
	onMdContentChange,
	onLoadFile,
	onSaveFile,
}: SkillsFieldProps) {
	return (
		<div>
			<div className="flex items-center justify-between mb-1.5">
				<label className={labelClass + ' mb-0'}>Skills</label>
				{agent ? (
					<button
						type="button"
						onClick={onToggleMode}
						className="flex items-center gap-1 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
					>
						<FileText size={11} />
						{skillsMode === 'inline' ? 'View .md file' : 'Edit inline'}
					</button>
				) : (
					<span className="text-[10px] text-[#404040] italic">.md files available after save</span>
				)}
			</div>
			{skillsMode === 'file' ? (
				<div className="bg-[#0a0a0a] border border-[#262626] rounded-lg p-3">
					<div className="flex items-center justify-between mb-2">
						<span className="text-[11px] text-[#525252] font-mono">skills.md</span>
						<button
							type="button"
							onClick={onLoadFile}
							className="text-[11px] text-[#22c55e] hover:underline"
						>
							Reload from file
						</button>
					</div>
					<textarea
						value={skillsMdContent}
						onChange={(e) => onMdContentChange(e.target.value)}
						rows={6}
						className={inputClass + ' resize-none font-mono text-[12px] leading-relaxed'}
					/>
					<button
						type="button"
						onClick={onSaveFile}
						className="mt-2 text-[11px] px-2 py-1 rounded bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
					>
						Save to .md file
					</button>
				</div>
			) : (
				<>
					<div className="flex gap-2">
						<input
							type="text"
							value={skillInput}
							onChange={(e) => onSkillInputChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									onAddSkill();
								}
							}}
							placeholder="TypeScript, React, Testing..."
							className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[13px] text-[#fafafa] placeholder-[#525252] focus:border-[#22c55e] focus:outline-none"
						/>
						<button
							onClick={onAddSkill}
							type="button"
							className="px-3 py-2 rounded-lg bg-[#1f1f1f] text-[#a3a3a3] hover:text-[#fafafa] text-[12px] font-medium transition-colors"
						>
							Add
						</button>
					</div>
					{skills.length > 0 && (
						<div className="flex flex-wrap gap-1.5 mt-2">
							{skills.map((skill) => (
								<span
									key={skill}
									className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20"
								>
									{skill}
									<button
										onClick={() => onRemoveSkill(skill)}
										type="button"
										className="hover:text-white"
									>
										<X size={10} />
									</button>
								</span>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
