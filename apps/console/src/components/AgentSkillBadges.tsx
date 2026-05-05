import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { assignSkillToAgent, fetchAgentSkills, fetchSkills, removeSkillFromAgent } from "../lib/studio-api/skills.js";
import type { Skill } from "../lib/studio-api/skills.js";

// Category renkleri — her kategori için sabit bir renk tonu
const CATEGORY_COLORS: Record<string, string> = {
	engineering: "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20",
	testing: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20",
	design: "bg-[#a855f7]/10 text-[#a855f7] border-[#a855f7]/20",
	devops: "bg-[#06b6d4]/10 text-[#06b6d4] border-[#06b6d4]/20",
	security: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20",
	management: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/20",
	data: "bg-[#8b5cf6]/10 text-[#8b5cf6] border-[#8b5cf6]/20",
};

function categoryColor(category: string): string {
	return CATEGORY_COLORS[category.toLowerCase()] ?? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20";
}

interface AgentSkillBadgesProps {
	agentId: string;
	agentRole: string;
}

export default function AgentSkillBadges({ agentId, agentRole }: AgentSkillBadgesProps) {
	const [skills, setSkills] = useState<Skill[]>([]);
	const [available, setAvailable] = useState<Skill[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [loadingAssign, setLoadingAssign] = useState<string | null>(null);
	const [loadingRemove, setLoadingRemove] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pickerRef = useRef<HTMLDivElement>(null);

	// Ajana atanmış yetenekleri yükle
	useEffect(() => {
		let cancelled = false;
		fetchAgentSkills(agentId)
			.then((data) => {
				if (!cancelled) setSkills(data);
			})
			.catch(() => {
				if (!cancelled) setSkills([]);
			});
		return () => {
			cancelled = true;
		};
	}, [agentId]);

	// Kullanılabilir yetenekleri yükle (role göre filtrelenmiş)
	useEffect(() => {
		let cancelled = false;
		fetchSkills({ role: agentRole })
			.then((data) => {
				if (!cancelled) setAvailable(data);
			})
			.catch(() => {
				if (!cancelled) setAvailable([]);
			});
		return () => {
			cancelled = true;
		};
	}, [agentRole]);

	// Picker dışına tıklandığında kapat
	useEffect(() => {
		if (!pickerOpen) return;
		const handler = (e: MouseEvent) => {
			if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
				setPickerOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [pickerOpen]);

	const assignedIds = new Set(skills.map((s) => s.id));
	const unassigned = available.filter((s) => !assignedIds.has(s.id));

	const handleAssign = useCallback(
		async (skillId: string) => {
			setLoadingAssign(skillId);
			setError(null);
			try {
				await assignSkillToAgent(agentId, skillId);
				const skill = available.find((s) => s.id === skillId);
				if (skill) setSkills((prev) => [...prev, skill]);
				setPickerOpen(false);
			} catch {
				setError("Yetenek atanamadı.");
			} finally {
				setLoadingAssign(null);
			}
		},
		[agentId, available],
	);

	const handleRemove = useCallback(
		async (skillId: string) => {
			setLoadingRemove(skillId);
			setError(null);
			try {
				await removeSkillFromAgent(agentId, skillId);
				setSkills((prev) => prev.filter((s) => s.id !== skillId));
			} catch {
				setError("Yetenek kaldırılamadı.");
			} finally {
				setLoadingRemove(null);
			}
		},
		[agentId],
	);

	return (
		<div className="relative flex flex-wrap items-center gap-1">
			{/* Atanmış yetenek rozet listesi */}
			{skills.map((skill) => (
				<span
					key={skill.id}
					className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${categoryColor(skill.category)}`}
				>
					{skill.name}
					<button
						onClick={() => handleRemove(skill.id)}
						disabled={loadingRemove === skill.id}
						className="ml-0.5 leading-none hover:opacity-70 transition-opacity disabled:opacity-40"
						title="Yetkiyi kaldır"
						aria-label={`${skill.name} yetkisini kaldır`}
					>
						{loadingRemove === skill.id ? <Loader2 size={9} className="animate-spin" /> : <X size={9} />}
					</button>
				</span>
			))}

			{/* "+" butonu — picker açar */}
			<div className="relative" ref={pickerRef}>
				<button
					onClick={() => setPickerOpen((v) => !v)}
					className="w-5 h-5 rounded-full bg-[#1a1a1a] text-[#525252] hover:text-[#22c55e] hover:bg-[#22c55e]/10 flex items-center justify-center transition-colors"
					title="Yetenek ekle"
					aria-label="Yetenek ekle"
				>
					<Plus size={11} />
				</button>

				{/* Picker dropdown */}
				{pickerOpen && (
					<div className="absolute left-0 top-6 z-20 w-52 bg-[#1a1a1a] border border-[#262626] rounded-lg shadow-xl overflow-hidden">
						<div className="px-3 py-1.5 border-b border-[#262626]">
							<span className="text-[10px] font-medium text-[#525252] uppercase tracking-wide">Yetenek Ekle</span>
						</div>
						{unassigned.length === 0 ? (
							<p className="px-3 py-2 text-[11px] text-[#525252]">
								{available.length === 0 ? "Yükleniyor..." : "Tüm yetenekler atanmış"}
							</p>
						) : (
							<div className="max-h-44 overflow-y-auto">
								{unassigned.map((skill) => (
									<button
										key={skill.id}
										onClick={() => handleAssign(skill.id)}
										disabled={loadingAssign === skill.id}
										className="flex items-center justify-between w-full text-left px-3 py-1.5 text-[11px] text-[#a3a3a3] hover:bg-[#262626] hover:text-[#fafafa] transition-colors disabled:opacity-50"
									>
										<span>{skill.name}</span>
										<span className="text-[10px] text-[#525252] ml-2 shrink-0">{skill.category}</span>
										{loadingAssign === skill.id && <Loader2 size={10} className="ml-1 animate-spin shrink-0" />}
									</button>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			{/* Hata mesajı */}
			{error && <span className="text-[10px] text-[#ef4444]">{error}</span>}
		</div>
	);
}
