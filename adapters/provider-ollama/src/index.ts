// @oscorpex/provider-ollama — Ollama local LLM adapter
// Communicates with the Ollama HTTP API at localhost:11434.
// No CLI binary is spawned; uses fetch for all operations.
// Configure the base URL via OLLAMA_HOST env var.

import type {
	ProviderAdapter,
	ProviderCapabilities,
	ProviderExecutionInput,
	ProviderExecutionResult,
	ProviderHealth,
} from "@oscorpex/core";
import { ProviderUnavailableError, ProviderExecutionError, ProviderTimeoutError } from "@oscorpex/core";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function resolveBaseUrl(): string {
	return (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
}

function resolveModel(): string {
	return process.env.OLLAMA_MODEL ?? "llama3.2";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OllamaTag {
	name: string;
	model: string;
	size: number;
	digest: string;
	modified_at: string;
	details?: {
		parameter_size?: string;
		quantization_level?: string;
	};
}

interface OllamaTagsResponse {
	models: OllamaTag[];
}

interface OllamaGenerateRequest {
	model: string;
	prompt: string;
	stream: boolean;
	options?: {
		temperature?: number;
		num_predict?: number;
	};
}

interface OllamaGenerateResponse {
	model: string;
	created_at: string;
	response: string;
	done: boolean;
	done_reason?: string;
	context?: number[];
	total_duration?: number;
	load_duration?: number;
	prompt_eval_count?: number;
	prompt_eval_duration?: number;
	eval_count?: number;
	eval_duration?: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OllamaAdapter implements ProviderAdapter {
	readonly id = "ollama";
	private baseUrl = resolveBaseUrl();

	capabilities(): ProviderCapabilities {
		return {
			supportsToolRestriction: false,
			supportsStreaming: false,
			supportsResume: false,
			supportsCancel: true,
			supportsStructuredOutput: false,
			supportsSandboxHinting: false,
			supportedModels: ["llama3.2", "codellama", "mistral", "phi4"],
		};
	}

	async isAvailable(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
			return res.ok;
		} catch {
			return false;
		}
	}

	async health(): Promise<ProviderHealth> {
		try {
			const res = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
			if (!res.ok) {
				return { healthy: false, message: `Ollama returned ${res.status}` };
			}
			const data = (await res.json()) as OllamaTagsResponse;
			const models = data.models?.map((m) => m.name).join(", ") ?? "none";
			return {
				healthy: true,
				message: `Ollama ready. Models: ${models}`,
			};
		} catch (err) {
			return {
				healthy: false,
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
		const startedAt = new Date().toISOString();

		// Availability pre-check
		const available = await this.isAvailable();
		if (!available) {
			throw new ProviderUnavailableError(this.id, `Ollama server not reachable at ${this.baseUrl}`);
		}

		const model = input.model ?? resolveModel();
		const timeoutMs = input.timeoutMs ?? 300_000;

		const body: OllamaGenerateRequest = {
			model,
			prompt: input.prompt,
			stream: false,
			options: {
				temperature: 0.2,
				num_predict: 8192,
			},
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		// Wire external cancel signal
		if (input.signal) {
			input.signal.addEventListener("abort", () => controller.abort(), { once: true });
		}

		let res: Response;
		try {
			res = await fetch(`${this.baseUrl}/api/generate`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (err) {
			clearTimeout(timer);
			if (err instanceof Error && err.name === "AbortError") {
				throw new ProviderTimeoutError(this.id, input.taskId, timeoutMs);
			}
			throw new ProviderExecutionError(this.id, input.taskId, null, `Ollama request failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			clearTimeout(timer);
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "unknown error");
			throw new ProviderExecutionError(this.id, input.taskId, res.status, `Ollama returned ${res.status}: ${text}`);
		}

		const data = (await res.json()) as OllamaGenerateResponse;
		const completedAt = new Date().toISOString();

		// Normalize usage
		const inputTokens = data.prompt_eval_count ?? 0;
		const outputTokens = data.eval_count ?? 0;

		return {
			provider: this.id,
			model: data.model ?? model,
			text: data.response ?? "",
			filesCreated: [],
			filesModified: [],
			logs: data.done_reason ? [`done_reason: ${data.done_reason}`] : [],
			usage: {
				inputTokens,
				outputTokens,
				billedCostUsd: 0, // local provider — no cost
			},
			startedAt,
			completedAt,
			metadata: {
				durationMs: data.total_duration ? Math.round(data.total_duration / 1_000_000) : undefined,
				loadDurationMs: data.load_duration ? Math.round(data.load_duration / 1_000_000) : undefined,
			},
		};
	}

	async cancel(input: { runId: string; taskId: string }): Promise<void> {
		// Registry-level cancel handles AbortController.signal;
		// adapter-level cancel is a no-op for now.
		void input;
	}
}
