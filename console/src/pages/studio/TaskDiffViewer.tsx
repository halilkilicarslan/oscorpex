// ---------------------------------------------------------------------------
// TaskDiffViewer — Per-task file diff display (v4.1)
// Shows file diffs captured when a task completes.
// ---------------------------------------------------------------------------

import { useState, useEffect } from "react";
import { FileCode, FilePlus, FileMinus, ChevronDown, ChevronRight, Plus, Minus, Loader2 } from "lucide-react";
import { fetchTaskDiffs, type TaskDiff, type TaskDiffSummary } from "../../lib/studio-api";

function DiffLine({ line }: { line: string }) {
	if (line.startsWith("+") && !line.startsWith("+++")) {
		return (
			<div className="text-[#22c55e] bg-[#22c55e]/5 px-3 py-0 font-mono text-[11px] leading-[18px] whitespace-pre overflow-x-auto">
				{line}
			</div>
		);
	}
	if (line.startsWith("-") && !line.startsWith("---")) {
		return (
			<div className="text-[#ef4444] bg-[#ef4444]/5 px-3 py-0 font-mono text-[11px] leading-[18px] whitespace-pre overflow-x-auto">
				{line}
			</div>
		);
	}
	if (line.startsWith("@@")) {
		return (
			<div className="text-[#3b82f6] bg-[#3b82f6]/5 px-3 py-0 font-mono text-[11px] leading-[18px] whitespace-pre overflow-x-auto">
				{line}
			</div>
		);
	}
	return (
		<div className="text-[#737373] px-3 py-0 font-mono text-[11px] leading-[18px] whitespace-pre overflow-x-auto">
			{line || " "}
		</div>
	);
}

const TYPE_ICON: Record<string, typeof FileCode> = { created: FilePlus, modified: FileCode, deleted: FileMinus };
const TYPE_COLOR: Record<string, string> = { created: "text-[#22c55e]", modified: "text-[#f59e0b]", deleted: "text-[#ef4444]" };
const TYPE_LABEL: Record<string, string> = { created: "Yeni", modified: "Degistirildi", deleted: "Silindi" };

function FileDiffCard({ diff }: { diff: TaskDiff }) {
	const [expanded, setExpanded] = useState(false);
	const Icon = TYPE_ICON[diff.diffType] ?? FileCode;
	const color = TYPE_COLOR[diff.diffType] ?? "text-[#a1a1aa]";
	const label = TYPE_LABEL[diff.diffType] ?? diff.diffType;
	const lines = diff.diffContent.split("\n");

	return (
		<div className="border border-[#262626] rounded-lg overflow-hidden">
			<button
				type="button"
				className="w-full flex items-center gap-2 px-3 py-2 bg-[#111111] hover:bg-[#1a1a1a] transition-colors text-left"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? <ChevronDown size={14} className="text-[#525252]" /> : <ChevronRight size={14} className="text-[#525252]" />}
				<Icon className={`w-3.5 h-3.5 ${color}`} />
				<span className="text-[12px] text-[#e4e4e7] font-mono flex-1 truncate">{diff.filePath}</span>
				<span className={`text-[10px] px-1.5 py-0.5 rounded border border-current/20 ${color}`}>{label}</span>
				{diff.linesAdded > 0 && (
					<span className="text-[11px] text-[#22c55e] flex items-center gap-0.5">
						<Plus size={11} />{diff.linesAdded}
					</span>
				)}
				{diff.linesRemoved > 0 && (
					<span className="text-[11px] text-[#ef4444] flex items-center gap-0.5">
						<Minus size={11} />{diff.linesRemoved}
					</span>
				)}
			</button>
			{expanded && (
				<div className="max-h-[400px] overflow-y-auto bg-[#0a0a0a] border-t border-[#262626]">
					{lines.map((line, i) => (
						<DiffLine key={i} line={line} />
					))}
				</div>
			)}
		</div>
	);
}

interface TaskDiffViewerProps {
	projectId: string;
	taskId: string;
}

export function TaskDiffViewer({ projectId, taskId }: TaskDiffViewerProps) {
	const [diffs, setDiffs] = useState<TaskDiff[]>([]);
	const [summary, setSummary] = useState<TaskDiffSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	useEffect(() => {
		setLoading(true);
		setError("");
		fetchTaskDiffs(projectId, taskId)
			.then((res) => {
				setDiffs(res.diffs);
				setSummary(res.summary);
			})
			.catch((err) => setError(err?.message || "Diff verisi yuklenemedi"))
			.finally(() => setLoading(false));
	}, [projectId, taskId]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-6">
				<Loader2 size={16} className="text-[#525252] animate-spin" />
			</div>
		);
	}

	if (error) {
		return <div className="text-[12px] text-[#ef4444] py-3">{error}</div>;
	}

	if (diffs.length === 0) {
		return <div className="text-center py-4 text-[#525252] text-[12px]">Diff verisi bulunamadi.</div>;
	}

	return (
		<div className="space-y-2">
			{summary && (
				<div className="flex items-center gap-3 text-[11px] text-[#737373]">
					<span>{summary.totalFiles} dosya</span>
					<span className="flex items-center gap-0.5 text-[#22c55e]"><Plus size={11} />{summary.linesAdded}</span>
					<span className="flex items-center gap-0.5 text-[#ef4444]"><Minus size={11} />{summary.linesRemoved}</span>
				</div>
			)}
			{diffs.map((diff) => (
				<FileDiffCard key={diff.id} diff={diff} />
			))}
		</div>
	);
}
