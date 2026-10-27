import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Shield, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HermesTools {
	tools: string[];
	readOnly: boolean;
}

interface StatCardProps {
	label: string;
	value: string;
	color?: "green" | "blue" | "gray" | "default";
	icon?: React.ReactNode;
}

function StatCard({ label, value, color = "default", icon }: StatCardProps) {
	const colorClass =
		color === "green"
			? "text-[#22c55e]"
			: color === "blue"
				? "text-blue-400"
				: color === "gray"
					? "text-[#525252]"
					: "text-[#e5e5e5]";
	return (
		<div className="rounded-xl border border-[#262626] bg-[#111] p-5 space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs text-[#525252] font-medium uppercase tracking-wide">{label}</span>
				{icon && <span className={colorClass}>{icon}</span>}
			</div>
			<p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
		</div>
	);
}

const DENIED_WRITE_TOOLS = [
	"file.write",
	"file.delete",
	"git.commit",
	"git.push",
	"shell.run",
	"shell.exec",
	"db.write",
	"db.delete",
	"fs.write",
	"fs.delete",
];

export default function HermesDashboardPage() {
	const [tools, setTools] = useState<HermesTools | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

	const fetchData = useCallback(() => {
		setLoading(true);
		setError(null);
		fetch("/api/studio/hermes/tools")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<HermesTools>;
			})
			.then((t) => {
				setTools(t);
				setLastUpdated(new Date());
			})
			.catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load Hermes data"))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const toolCount = tools?.tools.length ?? 0;
	const isEnabled = !error && tools !== null;

	return (
		<div className="p-6 space-y-6 min-h-screen bg-[#0a0a0a]">
			{/* Header */}
			<div className="flex items-end justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-xl font-semibold text-[#e5e5e5]">Hermes Dashboard</h1>
					<p className="text-sm text-[#737373] mt-1">
						Read-only MCP gateway — tool registry, session metrics, and security posture.
					</p>
				</div>
				<button
					type="button"
					onClick={fetchData}
					disabled={loading}
					className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-[#262626] text-[#a3a3a3] hover:bg-[#1a1a1a] disabled:opacity-50"
				>
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
					Refresh
				</button>
			</div>

			{/* Error */}
			{error && (
				<div
					role="alert"
					className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
				>
					<AlertTriangle size={15} />
					{error}
				</div>
			)}

			{/* Loading */}
			{loading && (
				<div className="flex items-center gap-2 text-[#737373] text-sm">
					<Loader2 size={15} className="animate-spin" />
					Loading Hermes data...
				</div>
			)}

			{/* Stat cards */}
			{!loading && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<StatCard
						label="Status"
						value={isEnabled ? "Enabled" : "Unavailable"}
						color={isEnabled ? "green" : "gray"}
						icon={<CheckCircle2 size={18} />}
					/>
					<StatCard label="Mode" value="Read-Only" color="blue" icon={<Shield size={18} />} />
					<StatCard label="Available Tools" value={String(toolCount)} icon={<Wrench size={18} />} />
					<StatCard label="Last Updated" value={lastUpdated ? lastUpdated.toLocaleTimeString() : "—"} />
				</div>
			)}

			{/* Read-only tool list */}
			{!loading && tools && tools.tools.length > 0 && (
				<div className="rounded-xl border border-[#262626] bg-[#111] p-5 space-y-4">
					<div className="flex items-center gap-2">
						<CheckCircle2 size={15} className="text-[#22c55e]" />
						<h2 className="text-sm font-medium text-[#e5e5e5]">Allowed Read-Only Tools</h2>
						<span className="ml-auto text-xs text-[#525252]">{tools.tools.length} tools</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{tools.tools.map((t) => (
							<span
								key={t}
								className="px-2.5 py-1 text-xs rounded-md bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] font-mono"
							>
								{t}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Denied write tools notice */}
			<div className="rounded-xl border border-red-500/10 bg-red-500/5 p-5 space-y-4">
				<div className="flex items-center gap-2">
					<Shield size={15} className="text-red-400" />
					<h2 className="text-sm font-medium text-red-400">Denied Write Tools (Blocked by Policy)</h2>
				</div>
				<div className="flex flex-wrap gap-2">
					{DENIED_WRITE_TOOLS.map((t) => (
						<span
							key={t}
							className="px-2.5 py-1 text-xs rounded-md bg-red-500/10 border border-red-500/20 text-red-400 font-mono"
						>
							{t}
						</span>
					))}
				</div>
				<p className="text-xs text-[#737373]">
					Write, mutating, and shell tools are denied by default. Hermes operates in read-only mode. Write approvals
					require explicit human-in-the-loop gate activation.
				</p>
			</div>

			{/* Security posture summary */}
			<div className="rounded-xl border border-[#262626] bg-[#111] p-5 space-y-3">
				<h2 className="text-sm font-medium text-[#e5e5e5]">Security Posture</h2>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[#a3a3a3]">
					{[
						{ label: "Prompt injection detection", status: "Active" },
						{ label: "Tenant isolation enforcement", status: "Active" },
						{ label: "Session token budget", status: "Active" },
						{ label: "Outbound secret redaction", status: "Active" },
						{ label: "Rate limiting (30 req/min)", status: "Active" },
						{ label: "Tool policy enforcer", status: "Active" },
						{ label: "Write tool gate", status: "Disabled (default)" },
						{ label: "MCP audit trail", status: "Active" },
					].map(({ label, status }) => {
						const isActive = status === "Active";
						return (
							<div key={label} className="flex items-center justify-between gap-2 py-1.5 border-b border-[#1a1a1a]">
								<span>{label}</span>
								<span className={`font-medium ${isActive ? "text-[#22c55e]" : "text-[#525252]"}`}>{status}</span>
							</div>
						);
					})}
				</div>
			</div>

			{/* Links */}
			<div className="flex items-center gap-4 text-xs text-[#525252]">
				<a href="/studio/mcp/audit" className="hover:text-[#a3a3a3] transition-colors">
					MCP Audit Log
				</a>
				<span>·</span>
				<a href="/studio/mcp/metrics" className="hover:text-[#a3a3a3] transition-colors">
					MCP Metrics
				</a>
				<span>·</span>
				<a href="/studio/hermes/keys" className="hover:text-[#a3a3a3] transition-colors">
					API Key Management
				</a>
			</div>
		</div>
	);
}
