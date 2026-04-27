// ---------------------------------------------------------------------------
// Tests — Ollama Adapter (EPIC 2)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaAdapter } from "../index.js";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
	mockFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function mockResponse(ok: boolean, body: unknown, status = 200): Response {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as Response;
}

// ---------------------------------------------------------------------------
// Adapter identity
// ---------------------------------------------------------------------------

describe("OllamaAdapter identity", () => {
	it("has id 'ollama'", () => {
		const adapter = new OllamaAdapter();
		expect(adapter.id).toBe("ollama");
	});
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe("OllamaAdapter.capabilities", () => {
	it("returns expected capability flags", () => {
		const adapter = new OllamaAdapter();
		const caps = adapter.capabilities();
		expect(caps.supportsToolRestriction).toBe(false);
		expect(caps.supportsStreaming).toBe(false);
		expect(caps.supportsResume).toBe(false);
		expect(caps.supportsCancel).toBe(true);
		expect(caps.supportsStructuredOutput).toBe(false);
		expect(caps.supportsSandboxHinting).toBe(false);
		expect(caps.supportedModels).toEqual(["llama3.2", "codellama", "mistral", "phi4"]);
	});
});

// ---------------------------------------------------------------------------
// isAvailable
// ---------------------------------------------------------------------------

describe("OllamaAdapter.isAvailable", () => {
	it("returns true when Ollama server responds", async () => {
		mockFetch.mockResolvedValueOnce(mockResponse(true, { models: [] }));
		const adapter = new OllamaAdapter();
		expect(await adapter.isAvailable()).toBe(true);
		expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/api/tags", { method: "GET" });
	});

	it("returns false when Ollama server is unreachable", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
		const adapter = new OllamaAdapter();
		expect(await adapter.isAvailable()).toBe(false);
	});

	it("returns false when Ollama returns non-ok status", async () => {
		mockFetch.mockResolvedValueOnce(mockResponse(false, {}, 500));
		const adapter = new OllamaAdapter();
		expect(await adapter.isAvailable()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe("OllamaAdapter.health", () => {
	it("returns healthy with model list", async () => {
		mockFetch.mockResolvedValueOnce(
			mockResponse(true, {
				models: [
					{ name: "llama3.2", model: "llama3.2", size: 1000, digest: "abc", modified_at: "2024-01-01" },
				],
			}),
		);
		const adapter = new OllamaAdapter();
		const health = await adapter.health();
		expect(health.healthy).toBe(true);
		expect(health.message).toContain("llama3.2");
	});

	it("returns unhealthy when server is down", async () => {
		mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
		const adapter = new OllamaAdapter();
		const health = await adapter.health();
		expect(health.healthy).toBe(false);
		expect(health.message).toContain("ECONNREFUSED");
	});
});

// ---------------------------------------------------------------------------
// execute shape
// ---------------------------------------------------------------------------

describe("OllamaAdapter.execute", () => {
	it("resolves with parsed response when Ollama returns JSON", async () => {
		mockFetch
			.mockResolvedValueOnce(mockResponse(true, { models: [] })) // isAvailable check
			.mockResolvedValueOnce(
				mockResponse(true, {
					model: "llama3.2",
					created_at: "2024-01-01T00:00:00Z",
					response: "Hello from Ollama",
					done: true,
					prompt_eval_count: 10,
					eval_count: 5,
					total_duration: 1_000_000_000,
				}),
			);

		const adapter = new OllamaAdapter();
		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "ollama",
			repoPath: "/tmp/repo",
			prompt: "Say hello",
			systemPrompt: "",
			timeoutMs: 30_000,
		});

		expect(result.text).toBe("Hello from Ollama");
		expect(result.provider).toBe("ollama");
		expect(result.model).toBe("llama3.2");
		expect(result.usage?.inputTokens).toBe(10);
		expect(result.usage?.outputTokens).toBe(5);
		expect(result.usage?.billedCostUsd).toBe(0);
		expect(result.startedAt).toBeDefined();
		expect(result.completedAt).toBeDefined();
		expect(result.metadata?.durationMs).toBe(1000);
	});

	it("uses the requested model", async () => {
		mockFetch
			.mockResolvedValueOnce(mockResponse(true, { models: [] }))
			.mockResolvedValueOnce(
				mockResponse(true, {
					model: "mistral",
					response: "ok",
					done: true,
				}),
			);

		const adapter = new OllamaAdapter();
		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "ollama",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 30_000,
			model: "mistral",
		});

		expect(result.model).toBe("mistral");
		const generateCall = mockFetch.mock.calls[1];
		const requestBody = JSON.parse(generateCall![1].body);
		expect(requestBody.model).toBe("mistral");
	});

	it("handles empty response gracefully", async () => {
		mockFetch
			.mockResolvedValueOnce(mockResponse(true, { models: [] }))
			.mockResolvedValueOnce(
				mockResponse(true, {
					model: "llama3.2",
					response: "",
					done: true,
				}),
			);

		const adapter = new OllamaAdapter();
		const result = await adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "ollama",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 30_000,
		});

		expect(result.text).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("OllamaAdapter.execute timeout", () => {
	it("throws ProviderTimeoutError when request times out", async () => {
		mockFetch
			.mockResolvedValueOnce(mockResponse(true, { models: [] }))
			.mockImplementationOnce((_url: string, init?: RequestInit) => {
				return new Promise((_, reject) => {
					const signal = init?.signal;
					if (signal) {
						const onAbort = () => {
							const err = new Error("AbortError");
							(err as any).name = "AbortError";
							reject(err);
						};
						if (signal.aborted) {
							onAbort();
							return;
						}
						signal.addEventListener("abort", onAbort, { once: true });
					}
				});
			});

		const adapter = new OllamaAdapter();
		const promise = adapter.execute({
			runId: "r1",
			taskId: "t1",
			provider: "ollama",
			repoPath: "/tmp/repo",
			prompt: "Do something",
			systemPrompt: "",
			timeoutMs: 50,
		});

		await expect(promise).rejects.toThrow("timed out");
	}, 10_000);
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe("OllamaAdapter.execute errors", () => {
	it("throws ProviderUnavailableError when server is unreachable", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

		const adapter = new OllamaAdapter();
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "ollama",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
			}),
		).rejects.toThrow("unavailable");
	});

	it("throws ProviderExecutionError on non-ok response", async () => {
		mockFetch
			.mockResolvedValueOnce(mockResponse(true, { models: [] }))
			.mockResolvedValueOnce(mockResponse(false, { error: "model not found" }, 404));

		const adapter = new OllamaAdapter();
		await expect(
			adapter.execute({
				runId: "r1",
				taskId: "t1",
				provider: "ollama",
				repoPath: "/tmp/repo",
				prompt: "Do something",
				systemPrompt: "",
				timeoutMs: 30_000,
			}),
		).rejects.toThrow("404");
	});
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("OllamaAdapter.cancel", () => {
	it("resolves without error", async () => {
		const adapter = new OllamaAdapter();
		await expect(adapter.cancel({ runId: "r1", taskId: "t1" })).resolves.toBeUndefined();
	});
});
