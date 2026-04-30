export default function TeamNotInitializedState({
	onSetupTeam,
}: {
	onSetupTeam: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 text-center">
			<div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
				<span className="text-amber-300 text-lg font-semibold">!</span>
			</div>
			<h3 className="text-[15px] font-semibold text-zinc-100 mb-2">Team not initialized</h3>
			<p className="text-[12px] text-zinc-400 max-w-md mb-5">
				Bu proje shell olarak oluşturuldu. Planner, pipeline, task ve runtime alanlarına geçmeden önce takım kurulmalı.
			</p>
			<button
				onClick={onSetupTeam}
				className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
			>
				Setup Team
			</button>
		</div>
	);
}

