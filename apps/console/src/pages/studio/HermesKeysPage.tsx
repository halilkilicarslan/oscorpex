import { AlertTriangle, CheckCircle2, Copy, Key, Loader2, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HermesKey {
	id: string;
	name: string;
	createdAt: string;
	enabled: boolean;
	lastUsedAt?: string;
}

interface HermesKeysResponse {
	keys: HermesKey[];
}

function formatDate(iso: string) {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

export default function HermesKeysPage() {
	const [keys, setKeys] = useState<HermesKey[]>([]);
	const [loading, setLoading] = useState(true);
	const [creating, setCreating] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const fetchKeys = useCallback(() => {
		setLoading(true);
		setError(null);
		fetch("/api/studio/hermes/keys")
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<HermesKeysResponse>;
			})
			.then((d) => setKeys(d.keys ?? []))
			.catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load keys"))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		fetchKeys();
	}, [fetchKeys]);

	const createKey = async () => {
		if (!newKeyName.trim()) return;
		setCreating(true);
		setError(null);
		try {
			const res = await fetch("/api/studio/hermes/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: newKeyName.trim() }),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(data.error ?? `HTTP ${res.status}`);
			}
			const data = (await res.json()) as { key?: string; id?: string };
			if (data.key) {
				setCreatedKey(data.key);
				setNewKeyName("");
				fetchKeys();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create key");
		} finally {
			setCreating(false);
		}
	};

	const revokeKey = async (id: string) => {
		setError(null);
		try {
			const res = await fetch(`/api/studio/hermes/keys/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			fetchKeys();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to revoke key");
		}
	};

	const copyKey = async () => {
		if (!createdKey) return;
		try {
			await navigator.clipboard.writeText(createdKey);
			setCopied(true);
			setTimeout(() => {
				setCopied(false);
				setCreatedKey(null);
			}, 2000);
		} catch {
			// Fallback — just dismiss
			setCreatedKey(null);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") void createKey();
	};

	return (
		<div className="p-6 space-y-6 min-h-screen bg-[#0a0a0a]">
			{/* Header */}
			<div className="flex items-end justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-xl font-semibold text-[#e5e5e5]">Hermes API Keys</h1>
					<p className="text-sm text-[#737373] mt-1">
						Manage API keys for external access to the Hermes read-only MCP gateway.
					</p>
				</div>
				<button
					type="button"
					onClick={fetchKeys}
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

			{/* Newly created key — show once */}
			{createdKey && (
				<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
					<div className="flex items-center gap-2">
						<Shield size={15} className="text-amber-400" />
						<p className="text-sm font-medium text-amber-400">API Key Created — Copy now, shown only once</p>
					</div>
					<code className="block p-3 rounded-lg bg-[#0a0a0a] border border-[#262626] text-xs text-[#e5e5e5] font-mono break-all select-all">
						{createdKey}
					</code>
					<button
						type="button"
						onClick={() => void copyKey()}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 hover:bg-[#22c55e]/20 transition-colors"
					>
						{copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
						{copied ? "Copied!" : "Copy & Dismiss"}
					</button>
				</div>
			)}

			{/* Create new key */}
			<div className="rounded-xl border border-[#262626] bg-[#111] p-5 space-y-4">
				<h2 className="text-sm font-medium text-[#e5e5e5] flex items-center gap-2">
					<Plus size={14} />
					Create New Key
				</h2>
				<div className="flex gap-2">
					<input
						type="text"
						value={newKeyName}
						onChange={(e) => setNewKeyName(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Key name (e.g. ci-pipeline, staging-monitor)"
						className="flex-1 px-3 py-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-[#e5e5e5] text-sm placeholder-[#525252] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/50 focus-visible:border-[#22c55e]/50"
					/>
					<button
						type="button"
						onClick={() => void createKey()}
						disabled={creating || !newKeyName.trim()}
						className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 text-sm hover:bg-[#22c55e]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						{creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
						Create Key
					</button>
				</div>
				<p className="text-xs text-[#525252]">
					Keys are stored as SHA-256 hashes. Raw values cannot be retrieved after creation.
				</p>
			</div>

			{/* Keys table */}
			<div className="rounded-xl border border-[#262626] bg-[#111] overflow-hidden">
				{loading ? (
					<div className="flex items-center gap-2 p-6 text-[#737373] text-sm">
						<Loader2 size={15} className="animate-spin" />
						Loading keys...
					</div>
				) : keys.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-16 gap-3 text-[#525252]">
						<Key size={24} />
						<p className="text-sm">No API keys created yet.</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full text-xs">
							<thead className="border-b border-[#262626] text-[#525252]">
								<tr>
									<th className="py-3 px-4 text-left font-medium">Name</th>
									<th className="py-3 px-4 text-left font-medium">ID</th>
									<th className="py-3 px-4 text-left font-medium">Status</th>
									<th className="py-3 px-4 text-left font-medium">Created</th>
									<th className="py-3 px-4 text-left font-medium">Last Used</th>
									<th className="py-3 px-4 text-left font-medium">Actions</th>
								</tr>
							</thead>
							<tbody>
								{keys.map((k) => (
									<tr key={k.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors">
										<td className="py-3 px-4 text-[#e5e5e5] font-medium">{k.name}</td>
										<td className="py-3 px-4 text-[#737373] font-mono">{k.id.slice(0, 12)}…</td>
										<td className="py-3 px-4">
											<span
												className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border ${
													k.enabled
														? "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20"
														: "bg-red-500/10 text-red-400 border-red-500/20"
												}`}
											>
												<span className={`w-1.5 h-1.5 rounded-full ${k.enabled ? "bg-[#22c55e]" : "bg-red-400"}`} />
												{k.enabled ? "Active" : "Revoked"}
											</span>
										</td>
										<td className="py-3 px-4 text-[#737373] whitespace-nowrap">{formatDate(k.createdAt)}</td>
										<td className="py-3 px-4 text-[#737373] whitespace-nowrap">
											{k.lastUsedAt ? formatDate(k.lastUsedAt) : <span className="text-[#525252]">Never</span>}
										</td>
										<td className="py-3 px-4">
											{k.enabled && (
												<button
													type="button"
													onClick={() => void revokeKey(k.id)}
													className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-colors"
												>
													<Trash2 size={11} />
													Revoke
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Security notice */}
			<div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#262626] text-xs text-[#737373]">
				<Shield size={14} className="mt-0.5 shrink-0 text-[#525252]" />
				<span>
					Hermes API keys grant read-only access to the MCP gateway. Keys are rate-limited to 30 requests/minute per
					actor. Revoked keys cannot be re-enabled — create a new key if needed.
				</span>
			</div>
		</div>
	);
}
