import { X } from 'lucide-react';
import type { AvatarOption, Gender } from "../../../lib/studio-api";

interface AvatarPickerProps {
	avatar: string;
	name: string;
	gender: Gender;
	avatarOptions: AvatarOption[];
	showAvatarPicker: boolean;
	onAvatarChange: (url: string) => void;
	onTogglePicker: () => void;
}

export default function AvatarPicker({
	avatar,
	gender,
	avatarOptions,
	showAvatarPicker,
	onAvatarChange,
	onTogglePicker,
}: AvatarPickerProps) {
	if (!showAvatarPicker) return null;

	return (
		<div className="bg-[#0a0a0a] border border-[#262626] rounded-xl p-3">
			<div className="flex items-center justify-between mb-2">
				<span className="text-[11px] text-[#525252]">
					Select avatar ({gender === 'male' ? 'Male' : 'Female'})
				</span>
				<button
					type="button"
					onClick={onTogglePicker}
					className="text-[#525252] hover:text-[#a3a3a3]"
				>
					<X size={14} />
				</button>
			</div>
			<div className="grid grid-cols-6 gap-2 max-h-[200px] overflow-y-auto">
				{avatarOptions.map((opt) => (
					<button
						key={opt.url}
						type="button"
						onClick={() => {
							onAvatarChange(opt.url);
							onTogglePicker();
						}}
						className={`relative group rounded-lg p-1 transition-all ${
							avatar === opt.url
								? 'ring-2 ring-[#22c55e] bg-[#22c55e]/10'
								: 'hover:bg-[#1f1f1f]'
						}`}
						title={opt.name}
					>
						<img
							src={opt.url}
							alt={opt.name}
							className="w-full aspect-square rounded-full object-cover"
							loading="lazy"
						/>
						<span className="absolute bottom-0 left-0 right-0 text-[8px] text-center text-[#737373] truncate opacity-0 group-hover:opacity-100 transition-opacity">
							{opt.name}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}
