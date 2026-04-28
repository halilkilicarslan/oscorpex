import { FileText } from 'lucide-react';
import type { ProjectAgent } from '../../lib/studio-api';

interface SystemPromptFieldProps {
	systemPrompt: string;
	promptMode: 'inline' | 'file';
	agent?: ProjectAgent;
	inputClass: string;
	labelClass: string;
	onPromptChange: (value: string) => void;
	onToggleMode: () => void;
	onLoadFile: () => void;
	onSaveFile: () => void;
}

export default function SystemPromptField({
	systemPrompt,
	promptMode,
	agent,
	inputClass,
	labelClass,
	onPromptChange,
	onToggleMode,
	onLoadFile,
	onSaveFile,
}: SystemPromptFieldProps) {
	return (
		<div>
			<div className="flex items-center justify-between mb-1.5">
				<label className={labelClass + ' mb-0'}>System Prompt</label>
				{agent ? (
					<button
						type="button"
						onClick={onToggleMode}
						className="flex items-center gap-1 text-[11px] text-[#525252] hover:text-[#a3a3a3] transition-colors"
					>
						<FileText size={11} />
						{promptMode === 'inline' ? 'View .md file' : 'Edit inline'}
					</button>
				) : (
					<span className="text-[10px] text-[#404040] italic">.md files available after save</span>
				)}
			</div>
			{promptMode === 'file' ? (
				<div className="bg-[#0a0a0a] border border-[#262626] rounded-lg p-3">
					<div className="flex items-center justify-between mb-2">
						<span className="text-[11px] text-[#525252] font-mono">system-prompt.md</span>
						<button
							type="button"
							onClick={onLoadFile}
							className="text-[11px] text-[#22c55e] hover:underline"
						>
							Reload from file
						</button>
					</div>
					<textarea
						value={systemPrompt}
						onChange={(e) => onPromptChange(e.target.value)}
						rows={8}
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
				<textarea
					value={systemPrompt}
					onChange={(e) => onPromptChange(e.target.value)}
					placeholder="You are a senior frontend engineer..."
					rows={6}
					className={inputClass + ' resize-none font-mono text-[12px] leading-relaxed'}
				/>
			)}
		</div>
	);
}
