import { Settings2 } from 'lucide-react';
import type { CLIUsageSnapshot, CLIProviderId } from "../../../lib/studio-api";

interface SettingsTabProps {
	selected: CLIUsageSnapshot;
	onSettingsChange: (providerId: CLIProviderId, patch: Partial<CLIUsageSnapshot['permissions']>) => void;
}

export default function SettingsTab({ selected, onSettingsChange }: SettingsTabProps) {
	return (
		<div className="space-y-4">
			<div className="rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/10 p-4 text-[12px] leading-6 text-[#f59e0b]">
				Secret values are never stored or displayed. Network probes use provider APIs first when
				credentials are available; only derived usage metrics are saved.
			</div>
			{[
				['enabled', 'Enable global quota probe'],
				['allowAuthFileRead', 'Allow local auth/session file read'],
				['allowNetworkProbe', 'Allow network quota probe'],
			].map(([key, label]) => (
				<label
					key={key}
					className="flex items-center justify-between gap-4 rounded-2xl border border-[#262626] bg-[#0a0a0a] px-4 py-3"
				>
					<span className="flex items-center gap-2 text-[13px] text-[#fafafa]">
						<Settings2 size={14} className="text-[#737373]" />
						{label}
					</span>
					<input
						type="checkbox"
						checked={Boolean((selected.permissions as any)[key])}
						onChange={(event) =>
							onSettingsChange(selected.providerId, { [key]: event.target.checked } as any)
						}
					/>
				</label>
			))}
			<label className="block rounded-2xl border border-[#262626] bg-[#0a0a0a] px-4 py-3">
				<span className="text-[13px] text-[#fafafa]">Refresh interval seconds</span>
				<input
					type="number"
					min={60}
					value={selected.permissions.refreshIntervalSec}
					onChange={(event) =>
						onSettingsChange(selected.providerId, {
							refreshIntervalSec: Number(event.target.value) || 300,
						})
					}
					className="mt-2 w-full rounded-xl border border-[#262626] bg-[#080808] px-3 py-2 text-[13px] text-[#fafafa]"
				/>
			</label>
		</div>
	);
}
