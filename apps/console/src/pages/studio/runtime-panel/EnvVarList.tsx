import { Eye, EyeOff, Loader2, Settings2 } from 'lucide-react';
import { CATEGORY_LABELS } from './helpers';
import type { EnvVarRequirement } from "../../../lib/studio-api";

interface EnvVarListProps {
	envVars: EnvVarRequirement[];
	envValues: Record<string, string>;
	showSensitive: Record<string, boolean>;
	actionLoading: string | null;
	onEnvValueChange: (key: string, value: string) => void;
	onToggleSensitive: (key: string) => void;
	onSaveEnv: () => void;
}

export default function EnvVarList({
	envVars,
	envValues,
	showSensitive,
	actionLoading,
	onEnvValueChange,
	onToggleSensitive,
	onSaveEnv,
}: EnvVarListProps) {
	if (envVars.length === 0) {
		return (
			<div className="text-xs text-[#71717a] py-2">
				.env.example bulunamadi. Env var gereksinimleri otomatik algilanamadi.
			</div>
		);
	}

	const grouped = envVars.reduce<Record<string, EnvVarRequirement[]>>((acc, v) => {
		(acc[v.category] ??= []).push(v);
		return acc;
	}, {});

	return (
		<div className="space-y-3">
			{Object.entries(grouped).map(([category, vars]) => (
				<div key={category}>
					<div className="text-[10px] text-[#71717a] uppercase tracking-wide mb-1.5">
						{CATEGORY_LABELS[category] || category}
					</div>
					<div className="space-y-1.5">
						{vars.map((v) => (
							<div key={v.key} className="flex items-center gap-2">
								<label className="text-[11px] text-[#a1a1aa] font-mono w-[180px] truncate flex items-center gap-1">
									{v.required && <span className="text-[#ef4444]">*</span>}
									{v.key}
								</label>
								<div className="flex-1 relative">
									<input
										type={v.sensitive && !showSensitive[v.key] ? 'password' : 'text'}
										value={envValues[v.key] || ''}
										onChange={(e) => onEnvValueChange(v.key, e.target.value)}
										placeholder={v.description || v.defaultValue || ''}
										className="w-full text-xs px-2 py-1 rounded bg-[#09090b] border border-[#27272a] text-[#fafafa] placeholder-[#3f3f46] font-mono pr-7"
									/>
									{v.sensitive && (
										<button
											onClick={() => onToggleSensitive(v.key)}
											className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#52525b] hover:text-[#a1a1aa]"
										>
											{showSensitive[v.key] ? <EyeOff size={11} /> : <Eye size={11} />}
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			))}

			<button
				onClick={onSaveEnv}
				disabled={actionLoading === 'env'}
				className="w-full text-xs px-3 py-1.5 rounded bg-[#3b82f6]/10 text-[#3b82f6] hover:bg-[#3b82f6]/20 flex items-center justify-center gap-1.5"
			>
				{actionLoading === 'env' ? (
					<Loader2 size={12} className="animate-spin" />
				) : (
					<Settings2 size={12} />
				)}
				Save .env
			</button>
		</div>
	);
}
