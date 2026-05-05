import { BookOpen, ChevronDown, Globe, Loader2, Lock, Plus, Save, Search, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Skill, createSkill, deleteSkill, fetchSkills, updateSkill } from "../../lib/studio-api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = ["All", "Framework", "Language", "Tool", "Workflow", "Company", "Custom"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

const PROVIDER_HINTS = ["", "claude-code", "codex", "cursor", "gemini", "ollama"] as const;

const CATEGORY_STYLES: Record<string, string> = {
	framework: "bg-blue-500/10 text-blue-400 border-blue-500/20",
	language: "bg-purple-500/10 text-purple-400 border-purple-500/20",
	tool: "bg-orange-500/10 text-orange-400 border-orange-500/20",
	workflow: "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20",
	company: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
	custom: "bg-[#525252]/20 text-[#a3a3a3] border-[#525252]/30",
};

const DEFAULT_FORM: Omit<Skill, "id" | "createdAt" | "updatedAt"> = {
	name: "",
	description: "",
	contentMd: "",
	triggers: [],
	applicableRoles: [],
	providerHint: "",
	modelHint: "",
	category: "custom",
	isGlobal: false,
	maxTokenBudget: 5000,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryBadge({ category }: { category: string }) {
	const styles = CATEGORY_STYLES[category.toLowerCase()] ?? CATEGORY_STYLES.custom;
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles}`}
		>
			{category}
		</span>
	);
}

function TriggerPill({ label, onRemove }: { label: string; onRemove?: () => void }) {
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-[#1f1f1f] border border-[#333] px-2 py-0.5 text-[11px] text-[#a3a3a3]">
			{label}
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					className="ml-0.5 text-[#525252] hover:text-[#ef4444] transition-colors"
					aria-label={`Remove ${label}`}
				>
					<X size={10} />
				</button>
			)}
		</span>
	);
}

function EmptyState({ onNew }: { onNew: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] border border-[#262626] flex items-center justify-center mb-4">
				<Sparkles size={28} className="text-[#333]" />
			</div>
			<h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">No skills yet</h3>
			<p className="text-[13px] text-[#525252] max-w-xs mb-5">
				Skills define reusable capabilities that agents can reference during task execution.
			</p>
			<button
				onClick={onNew}
				className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
			>
				<Plus size={14} />
				Create first skill
			</button>
		</div>
	);
}

interface SkillCardProps {
	skill: Skill;
	selected: boolean;
	onClick: () => void;
}

function SkillCard({ skill, selected, onClick }: SkillCardProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={[
				"w-full text-left rounded-xl border p-3.5 transition-all duration-100",
				selected
					? "border-[#22c55e]/40 bg-[#22c55e]/5"
					: "border-[#262626] bg-[#111111] hover:border-[#333] hover:bg-[#141414]",
			].join(" ")}
		>
			<div className="flex items-start justify-between gap-2 mb-2">
				<span className="text-[13px] font-medium text-[#fafafa] leading-snug line-clamp-1">{skill.name}</span>
				<div className="flex items-center gap-1.5 shrink-0">
					{skill.isGlobal ? (
						<Globe size={12} className="text-[#22c55e]" title="Global skill" />
					) : (
						<Lock size={12} className="text-[#525252]" title="Project-scoped" />
					)}
				</div>
			</div>

			{skill.description && (
				<p className="text-[11px] text-[#737373] line-clamp-2 mb-2.5 leading-relaxed">{skill.description}</p>
			)}

			<div className="flex items-center flex-wrap gap-1.5">
				<CategoryBadge category={skill.category} />
				{skill.triggers.slice(0, 3).map((t) => (
					<TriggerPill key={t} label={t} />
				))}
				{skill.triggers.length > 3 && <span className="text-[10px] text-[#525252]">+{skill.triggers.length - 3}</span>}
			</div>
		</button>
	);
}

// ---------------------------------------------------------------------------
// Editor panel
// ---------------------------------------------------------------------------

interface EditorPanelProps {
	skill: Skill | null;
	isNew: boolean;
	saving: boolean;
	deleting: boolean;
	onSave: (data: Omit<Skill, "id" | "createdAt" | "updatedAt">) => Promise<void>;
	onDelete: () => Promise<void>;
	onClose: () => void;
}

function EditorPanel({ skill, isNew, saving, deleting, onSave, onDelete, onClose }: EditorPanelProps) {
	const [form, setForm] = useState<Omit<Skill, "id" | "createdAt" | "updatedAt">>(
		skill
			? {
					name: skill.name,
					description: skill.description,
					contentMd: skill.contentMd,
					triggers: skill.triggers,
					applicableRoles: skill.applicableRoles,
					providerHint: skill.providerHint ?? "",
					modelHint: skill.modelHint ?? "",
					category: skill.category,
					isGlobal: skill.isGlobal,
					maxTokenBudget: skill.maxTokenBudget,
				}
			: { ...DEFAULT_FORM },
	);

	const [triggerInput, setTriggerInput] = useState("");
	const [roleInput, setRoleInput] = useState("");
	const [error, setError] = useState("");

	// Reset form when skill changes
	useEffect(() => {
		setError("");
		setTriggerInput("");
		setRoleInput("");
		if (skill) {
			setForm({
				name: skill.name,
				description: skill.description,
				contentMd: skill.contentMd,
				triggers: skill.triggers,
				applicableRoles: skill.applicableRoles,
				providerHint: skill.providerHint ?? "",
				modelHint: skill.modelHint ?? "",
				category: skill.category,
				isGlobal: skill.isGlobal,
				maxTokenBudget: skill.maxTokenBudget,
			});
		} else {
			setForm({ ...DEFAULT_FORM });
		}
	}, [skill]);

	const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	const addTrigger = (raw: string) => {
		const trimmed = raw.trim().toLowerCase();
		if (trimmed && !form.triggers.includes(trimmed)) {
			set("triggers", [...form.triggers, trimmed]);
		}
		setTriggerInput("");
	};

	const removeTrigger = (t: string) =>
		set(
			"triggers",
			form.triggers.filter((x) => x !== t),
		);

	const addRole = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed && !form.applicableRoles.includes(trimmed)) {
			set("applicableRoles", [...form.applicableRoles, trimmed]);
		}
		setRoleInput("");
	};

	const removeRole = (r: string) =>
		set(
			"applicableRoles",
			form.applicableRoles.filter((x) => x !== r),
		);

	const handleSubmit = async () => {
		if (!form.name.trim()) {
			setError("Skill name is required.");
			return;
		}
		setError("");
		await onSave(form);
	};

	const tokenEstimate = Math.ceil(form.contentMd.length / 4);
	const tokenPct = Math.min(100, (tokenEstimate / form.maxTokenBudget) * 100);
	const tokenOverBudget = tokenEstimate > form.maxTokenBudget;

	const inputCls =
		"w-full rounded-lg border border-[#262626] bg-[#0f0f0f] px-3 py-2 text-[13px] text-[#e5e5e5] placeholder-[#525252] outline-none focus:border-[#22c55e]/50 focus:ring-1 focus:ring-[#22c55e]/20 transition-colors";

	const labelCls = "block text-[11px] font-medium text-[#737373] mb-1.5 uppercase tracking-wide";

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Editor header */}
			<div className="flex items-center justify-between px-5 py-4 border-b border-[#262626] shrink-0">
				<h2 className="text-[14px] font-semibold text-[#fafafa]">{isNew ? "New Skill" : "Edit Skill"}</h2>
				<button
					type="button"
					onClick={onClose}
					className="p-1.5 rounded-lg text-[#525252] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
					aria-label="Close editor"
				>
					<X size={15} />
				</button>
			</div>

			{/* Scrollable form body */}
			<div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
				{error && (
					<div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
						{error}
					</div>
				)}

				{/* Name */}
				<div>
					<label className={labelCls}>Name *</label>
					<input
						type="text"
						value={form.name}
						onChange={(e) => set("name", e.target.value)}
						placeholder="e.g. TypeScript Best Practices"
						className={inputCls}
					/>
				</div>

				{/* Description */}
				<div>
					<label className={labelCls}>Description</label>
					<textarea
						value={form.description}
						onChange={(e) => set("description", e.target.value)}
						placeholder="Brief summary of what this skill does..."
						rows={2}
						className={`${inputCls} resize-none`}
					/>
				</div>

				{/* Category + Global row */}
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className={labelCls}>Category</label>
						<div className="relative">
							<select
								value={form.category}
								onChange={(e) => set("category", e.target.value)}
								className={`${inputCls} appearance-none pr-8`}
							>
								{CATEGORIES.filter((c) => c !== "All").map((c) => (
									<option key={c} value={c.toLowerCase()}>
										{c}
									</option>
								))}
							</select>
							<ChevronDown
								size={13}
								className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252]"
							/>
						</div>
					</div>
					<div>
						<label className={labelCls}>Scope</label>
						<button
							type="button"
							onClick={() => set("isGlobal", !form.isGlobal)}
							className={[
								"flex items-center gap-2 w-full rounded-lg border px-3 py-2 text-[13px] transition-colors",
								form.isGlobal
									? "border-[#22c55e]/30 bg-[#22c55e]/5 text-[#22c55e]"
									: "border-[#262626] bg-[#0f0f0f] text-[#525252] hover:border-[#333]",
							].join(" ")}
						>
							{form.isGlobal ? <Globe size={14} /> : <Lock size={14} />}
							{form.isGlobal ? "Global" : "Project-scoped"}
						</button>
					</div>
				</div>

				{/* Triggers */}
				<div>
					<label className={labelCls}>Triggers</label>
					<div className="flex flex-wrap gap-1.5 mb-2">
						{form.triggers.map((t) => (
							<TriggerPill key={t} label={t} onRemove={() => removeTrigger(t)} />
						))}
					</div>
					<input
						type="text"
						value={triggerInput}
						onChange={(e) => setTriggerInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === ",") {
								e.preventDefault();
								addTrigger(triggerInput);
							}
						}}
						onBlur={() => triggerInput.trim() && addTrigger(triggerInput)}
						placeholder="Type trigger and press Enter or comma..."
						className={inputCls}
					/>
					<p className="mt-1 text-[10px] text-[#525252]">
						Keywords that activate this skill (e.g. typescript, react, testing)
					</p>
				</div>

				{/* Applicable Roles */}
				<div>
					<label className={labelCls}>Applicable Roles</label>
					<div className="flex flex-wrap gap-1.5 mb-2">
						{form.applicableRoles.map((r) => (
							<TriggerPill key={r} label={r} onRemove={() => removeRole(r)} />
						))}
					</div>
					<input
						type="text"
						value={roleInput}
						onChange={(e) => setRoleInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === ",") {
								e.preventDefault();
								addRole(roleInput);
							}
						}}
						onBlur={() => roleInput.trim() && addRole(roleInput)}
						placeholder="e.g. backend-developer, qa-engineer..."
						className={inputCls}
					/>
				</div>

				{/* Provider + Model hints */}
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className={labelCls}>Provider Hint</label>
						<div className="relative">
							<select
								value={form.providerHint ?? ""}
								onChange={(e) => set("providerHint", e.target.value || undefined)}
								className={`${inputCls} appearance-none pr-8`}
							>
								{PROVIDER_HINTS.map((p) => (
									<option key={p} value={p}>
										{p || "— Any provider —"}
									</option>
								))}
							</select>
							<ChevronDown
								size={13}
								className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252]"
							/>
						</div>
					</div>
					<div>
						<label className={labelCls}>Model Hint</label>
						<input
							type="text"
							value={form.modelHint ?? ""}
							onChange={(e) => set("modelHint", e.target.value || undefined)}
							placeholder="e.g. claude-opus-4"
							className={inputCls}
						/>
					</div>
				</div>

				{/* Max Token Budget */}
				<div>
					<div className="flex items-center justify-between mb-1.5">
						<label className={labelCls}>Max Token Budget</label>
						<span className="text-[11px] font-mono text-[#a3a3a3]">{form.maxTokenBudget.toLocaleString()}</span>
					</div>
					<input
						type="range"
						min={1000}
						max={20000}
						step={500}
						value={form.maxTokenBudget}
						onChange={(e) => set("maxTokenBudget", Number(e.target.value))}
						className="w-full accent-[#22c55e] cursor-pointer"
					/>
					<div className="flex justify-between text-[10px] text-[#525252] mt-0.5">
						<span>1K</span>
						<span>20K</span>
					</div>
				</div>

				{/* Content editor */}
				<div>
					<div className="flex items-center justify-between mb-1.5">
						<label className={labelCls}>Content (Markdown)</label>
						<div className="flex items-center gap-2">
							<div className={`text-[10px] font-mono ${tokenOverBudget ? "text-red-400" : "text-[#525252]"}`}>
								~{tokenEstimate.toLocaleString()} tokens
							</div>
							<div className="w-20 h-1 rounded-full bg-[#1f1f1f] overflow-hidden">
								<div
									className={`h-full rounded-full transition-all ${tokenOverBudget ? "bg-red-500" : "bg-[#22c55e]"}`}
									style={{ width: `${tokenPct}%` }}
								/>
							</div>
						</div>
					</div>
					<textarea
						value={form.contentMd}
						onChange={(e) => set("contentMd", e.target.value)}
						placeholder={
							"# Skill Name\n\n## Overview\nDescribe what this skill does...\n\n## Guidelines\n- Guideline 1\n- Guideline 2"
						}
						rows={18}
						spellCheck={false}
						className={`${inputCls} resize-y font-mono text-[12px] leading-relaxed`}
					/>
					{tokenOverBudget && (
						<p className="mt-1 text-[11px] text-red-400">
							Content exceeds token budget. Consider splitting into multiple skills or increasing the budget.
						</p>
					)}
				</div>
			</div>

			{/* Footer actions */}
			<div className="shrink-0 border-t border-[#262626] px-5 py-3.5 flex items-center justify-between gap-3">
				{!isNew && (
					<button
						type="button"
						onClick={onDelete}
						disabled={deleting || saving}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors disabled:opacity-40"
					>
						{deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
						Delete
					</button>
				)}
				<div className="flex items-center gap-2 ml-auto">
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#737373] hover:text-[#a3a3a3] hover:bg-[#1f1f1f] transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={saving || deleting}
						className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors disabled:opacity-50"
					>
						{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
						{isNew ? "Create" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
	const [skills, setSkills] = useState<Skill[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	// List filters
	const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All");
	const [search, setSearch] = useState("");

	// Editor state
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const load = useCallback(async () => {
		try {
			setError("");
			const data = await fetchSkills();
			setSkills(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load skills");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	// Derived state
	const selectedSkill = skills.find((s) => s.id === selectedId) ?? null;
	const editorOpen = isNew || selectedId !== null;

	const filtered = skills.filter((s) => {
		const matchCat = categoryFilter === "All" || s.category.toLowerCase() === categoryFilter.toLowerCase();
		const q = search.toLowerCase();
		const matchSearch =
			!q ||
			s.name.toLowerCase().includes(q) ||
			s.description.toLowerCase().includes(q) ||
			s.triggers.some((t) => t.includes(q));
		return matchCat && matchSearch;
	});

	const openNew = () => {
		setSelectedId(null);
		setIsNew(true);
	};

	const openSkill = (id: string) => {
		setIsNew(false);
		setSelectedId(id);
	};

	const closeEditor = () => {
		setSelectedId(null);
		setIsNew(false);
	};

	const handleSave = async (data: Omit<Skill, "id" | "createdAt" | "updatedAt">) => {
		setSaving(true);
		try {
			if (isNew) {
				const created = await createSkill(data);
				setSkills((prev) => [created, ...prev]);
				setIsNew(false);
				setSelectedId(created.id);
			} else if (selectedId) {
				const updated = await updateSkill(selectedId, data);
				setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
			}
		} catch (err) {
			alert(err instanceof Error ? err.message : "Save failed");
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!selectedId || !confirm("Delete this skill? This cannot be undone.")) return;
		setDeleting(true);
		try {
			await deleteSkill(selectedId);
			setSkills((prev) => prev.filter((s) => s.id !== selectedId));
			closeEditor();
		} catch (err) {
			alert(err instanceof Error ? err.message : "Delete failed");
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="flex h-full overflow-hidden bg-[#0a0a0a]">
			{/* ------------------------------------------------------------------ */}
			{/* Left panel — skills list                                            */}
			{/* ------------------------------------------------------------------ */}
			<div
				className={[
					"flex flex-col border-r border-[#262626] shrink-0 transition-all duration-200",
					editorOpen ? "w-80 hidden md:flex" : "flex-1",
				].join(" ")}
			>
				{/* Header */}
				<div className="px-5 pt-5 pb-3 border-b border-[#262626]">
					<div className="flex items-center justify-between mb-3">
						<div>
							<h1 className="text-[16px] font-semibold text-[#fafafa]">Skills</h1>
							<p className="text-[12px] text-[#525252] mt-0.5">Reusable capabilities injected into agent context</p>
						</div>
						<button
							type="button"
							onClick={openNew}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
						>
							<Plus size={14} />
							New Skill
						</button>
					</div>

					{/* Search */}
					<div className="relative">
						<Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search skills..."
							className="w-full rounded-lg border border-[#262626] bg-[#111111] py-2 pl-8 pr-3 text-[13px] text-[#e5e5e5] placeholder-[#525252] outline-none focus:border-[#22c55e]/40 transition-colors"
						/>
						{search && (
							<button
								type="button"
								onClick={() => setSearch("")}
								className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#525252] hover:text-[#a3a3a3]"
							>
								<X size={13} />
							</button>
						)}
					</div>
				</div>

				{/* Category tabs */}
				<div className="flex items-center gap-0.5 px-4 py-2 border-b border-[#262626] overflow-x-auto scrollbar-none">
					{CATEGORIES.map((cat) => (
						<button
							key={cat}
							type="button"
							onClick={() => setCategoryFilter(cat)}
							className={[
								"shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
								categoryFilter === cat
									? "bg-[#1f1f1f] text-[#22c55e]"
									: "text-[#525252] hover:text-[#a3a3a3] hover:bg-[#141414]",
							].join(" ")}
						>
							{cat}
						</button>
					))}
				</div>

				{/* Skills list */}
				<div className="flex-1 overflow-y-auto p-3 space-y-2">
					{loading ? (
						<div className="flex items-center justify-center py-16">
							<Loader2 size={22} className="text-[#525252] animate-spin" />
						</div>
					) : error ? (
						<div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-400">
							{error}
							<button type="button" onClick={load} className="ml-2 underline hover:no-underline">
								Retry
							</button>
						</div>
					) : filtered.length === 0 ? (
						skills.length === 0 ? (
							<EmptyState onNew={openNew} />
						) : (
							<div className="py-12 text-center text-[13px] text-[#525252]">No skills match your filters.</div>
						)
					) : (
						filtered.map((skill) => (
							<SkillCard
								key={skill.id}
								skill={skill}
								selected={skill.id === selectedId}
								onClick={() => openSkill(skill.id)}
							/>
						))
					)}
				</div>

				{/* Footer count */}
				{!loading && skills.length > 0 && (
					<div className="px-4 py-2 border-t border-[#262626] text-[10px] text-[#525252]">
						{filtered.length} of {skills.length} skill{skills.length !== 1 ? "s" : ""}
					</div>
				)}
			</div>

			{/* ------------------------------------------------------------------ */}
			{/* Right panel — editor                                                */}
			{/* ------------------------------------------------------------------ */}
			{editorOpen ? (
				<div className="flex-1 flex flex-col overflow-hidden">
					<EditorPanel
						skill={isNew ? null : selectedSkill}
						isNew={isNew}
						saving={saving}
						deleting={deleting}
						onSave={handleSave}
						onDelete={handleDelete}
						onClose={closeEditor}
					/>
				</div>
			) : (
				/* Placeholder when nothing is selected and list is full-width */
				skills.length > 0 && (
					<div className="hidden md:flex flex-1 items-center justify-center text-center">
						<div>
							<BookOpen size={32} className="text-[#262626] mx-auto mb-3" />
							<p className="text-[13px] text-[#525252]">Select a skill to edit</p>
						</div>
					</div>
				)
			)}
		</div>
	);
}
