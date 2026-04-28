import { useState, useEffect } from 'react';
import { Plus, Loader2, Settings, Link } from 'lucide-react';
import {
	fetchProviders,
	updateProvider,
	deleteProvider,
	setDefaultProvider,
	testProvider,
	fetchFallbackChain,
	updateFallbackOrder,
	type AIProvider,
} from '../../lib/studio-api';
import {
	ProviderCard,
	ProviderModal,
	FallbackFlowIndicator,
	FallbackOrderPanel,
	type TestState,
} from './providers-page/index.js';

export default function ProvidersPage() {
	const [providers, setProviders] = useState<AIProvider[]>([]);
	const [loading, setLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [editingProvider, setEditingProvider] = useState<AIProvider | undefined>();
	const [testStates, setTestStates] = useState<Record<string, TestState>>({});
	const [testMessages, setTestMessages] = useState<Record<string, string>>({});

	const [fallbackChain, setFallbackChain] = useState<AIProvider[]>([]);
	const [fallbackSaving, setFallbackSaving] = useState(false);

	const load = async () => {
		try {
			const [data, chain] = await Promise.all([fetchProviders(), fetchFallbackChain()]);
			setProviders(data);
			setFallbackChain(chain);
		} catch { /* API not ready yet */ }
		finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		load();
	}, []);

	const handleSaved = (saved: AIProvider) => {
		setProviders((prev) => {
			const idx = prev.findIndex((p) => p.id === saved.id);
			if (idx >= 0) {
				const next = [...prev];
				next[idx] = saved;
				return next;
			}
			return [...prev, saved];
		});
		setShowModal(false);
		setEditingProvider(undefined);
		load();
	};

	const handleDelete = async (id: string) => {
		if (!confirm('Are you sure you want to delete this provider?')) return;
		try {
			await deleteProvider(id);
			setProviders((prev) => prev.filter((p) => p.id !== id));
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to delete provider');
		}
	};

	const handleSetDefault = async (id: string) => {
		try {
			await setDefaultProvider(id);
			load();
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to set default provider');
		}
	};

	const handleToggleActive = async (provider: AIProvider) => {
		try {
			const updated = await updateProvider(provider.id, { isActive: !provider.isActive });
			setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to update provider');
		}
	};

	const handleTest = async (id: string) => {
		setTestStates((prev) => ({ ...prev, [id]: 'testing' }));
		setTestMessages((prev) => ({ ...prev, [id]: '' }));
		try {
			const result = await testProvider(id);
			setTestStates((prev) => ({ ...prev, [id]: result.valid ? 'success' : 'failure' }));
			setTestMessages((prev) => ({ ...prev, [id]: result.message }));
		} catch (err) {
			setTestStates((prev) => ({ ...prev, [id]: 'failure' }));
			setTestMessages((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'Test failed' }));
		}
	};

	const handleFallbackMoveUp = async (index: number) => {
		if (index === 0 || fallbackSaving) return;
		const newChain = [...fallbackChain];
		[newChain[index - 1], newChain[index]] = [newChain[index], newChain[index - 1]];
		setFallbackChain(newChain);
		setFallbackSaving(true);
		try {
			const updated = await updateFallbackOrder(newChain.map((p) => p.id));
			setFallbackChain(updated);
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Sirama guncellenemedi');
			load();
		} finally {
			setFallbackSaving(false);
		}
	};

	const handleFallbackMoveDown = async (index: number) => {
		if (index === fallbackChain.length - 1 || fallbackSaving) return;
		const newChain = [...fallbackChain];
		[newChain[index], newChain[index + 1]] = [newChain[index + 1], newChain[index]];
		setFallbackChain(newChain);
		setFallbackSaving(true);
		try {
			const updated = await updateFallbackOrder(newChain.map((p) => p.id));
			setFallbackChain(updated);
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Sirama guncellenemedi');
			load();
		} finally {
			setFallbackSaving(false);
		}
	};

	const openAdd = () => {
		setEditingProvider(undefined);
		setShowModal(true);
	};

	const openEdit = (provider: AIProvider) => {
		setEditingProvider(provider);
		setShowModal(true);
	};

	return (
		<div className="p-6 max-w-5xl">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-xl font-semibold text-[#fafafa]">AI Providers</h1>
					<p className="text-sm text-[#737373] mt-1">Manage API keys and model settings for AI providers</p>
				</div>
				<button
					onClick={openAdd}
					className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e] text-[#0a0a0a] hover:bg-[#16a34a] transition-colors"
				>
					<Plus size={16} />
					Add Provider
				</button>
			</div>

			{loading ? (
				<div className="flex items-center justify-center py-20">
					<Loader2 size={24} className="text-[#525252] animate-spin" />
				</div>
			) : providers.length === 0 ? (
				<div className="bg-[#111111] border border-[#262626] rounded-xl p-16 flex flex-col items-center justify-center text-center">
					<div className="w-16 h-16 rounded-2xl bg-[#1f1f1f] flex items-center justify-center mb-4">
						<Settings size={28} className="text-[#333]" />
					</div>
					<h3 className="text-[15px] font-medium text-[#a3a3a3] mb-1">No providers yet</h3>
					<p className="text-[13px] text-[#525252] max-w-sm mb-4">
						Add an AI provider to connect your OpenAI, Anthropic, Google, or Ollama account.
					</p>
					<button
						onClick={openAdd}
						className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#22c55e]/10 text-[#22c55e] hover:bg-[#22c55e]/20 transition-colors"
					>
						<Plus size={14} />
						Add Provider
					</button>
				</div>
			) : (
				<div className="space-y-8">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{providers.map((provider) => (
							<ProviderCard
								key={provider.id}
								provider={provider}
								onEdit={() => openEdit(provider)}
								onDelete={() => handleDelete(provider.id)}
								onSetDefault={() => handleSetDefault(provider.id)}
								onToggleActive={() => handleToggleActive(provider)}
								onTest={() => handleTest(provider.id)}
								testState={testStates[provider.id] ?? 'idle'}
								testMessage={testMessages[provider.id]}
							/>
						))}
					</div>

					{fallbackChain.length >= 2 && (
						<div className="bg-[#0a0a0a] border border-[#262626] rounded-xl p-5">
							<div className="flex items-start gap-2.5 mb-5">
								<div className="w-8 h-8 rounded-lg bg-[#1f1f1f] flex items-center justify-center shrink-0 mt-0.5">
									<Link size={15} className="text-[#22c55e]" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<h2 className="text-[14px] font-semibold text-[#fafafa]">Fallback Chain</h2>
										{fallbackSaving && <Loader2 size={12} className="text-[#525252] animate-spin" />}
									</div>
									<p className="text-[11px] text-[#525252] mt-0.5">
										When the primary provider fails, the system automatically tries the next provider in order.
									</p>
								</div>
							</div>

							<FallbackFlowIndicator chain={fallbackChain} />
							<FallbackOrderPanel
								chain={fallbackChain}
								onMoveUp={handleFallbackMoveUp}
								onMoveDown={handleFallbackMoveDown}
								saving={fallbackSaving}
							/>
						</div>
					)}
				</div>
			)}

			{showModal && (
				<ProviderModal
					provider={editingProvider}
					onClose={() => {
						setShowModal(false);
						setEditingProvider(undefined);
					}}
					onSaved={handleSaved}
				/>
			)}
		</div>
	);
}
