// ---------------------------------------------------------------------------
// Oscorpex — AI Model Factory
// Yapılandırılmış provider tablosuna göre doğru AI SDK modelini döndürür.
// ---------------------------------------------------------------------------

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getDefaultProvider, getFallbackChain, getRawProviderApiKey } from "./db.js";
import type { AIProvider } from "./types.js";

/**
 * Varsayılan AI provider'ı veritabanından okuyarak uygun AI SDK modelini
 * oluşturur ve döndürür.
 *
 * Desteklenen provider tipleri:
 *  - openai    → @ai-sdk/openai  (createOpenAI)
 *  - anthropic → @ai-sdk/anthropic (createAnthropic)
 *  - google    → @ai-sdk/google  (createGoogleGenerativeAI)
 *  - ollama    → @ai-sdk/openai  (OpenAI uyumlu baseURL ile)
 *  - custom    → @ai-sdk/openai  (özel baseURL ile)
 *
 * Hiçbir varsayılan provider ayarlanmamışsa OPENAI_API_KEY env değişkenini
 * kullanarak gpt-4o-mini modeline geri döner.
 */
/** Returns the model along with its name and provider type for cost tracking */
export async function getAIModelInfo(): Promise<{ model: LanguageModelV3; modelName: string; providerType: string }> {
	const provider = await getDefaultProvider();
	const providerType = provider?.type ?? "openai";
	const modelName = provider?.model?.trim() || defaultModelForType(providerType);
	return { model: await getAIModel(), modelName, providerType };
}

/** Model bazlı fiyat tablosu (USD per 1M tokens) */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
	// OpenAI
	"gpt-4o": { input: 2.5, output: 10.0 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
	"gpt-4-turbo": { input: 10.0, output: 30.0 },
	"gpt-4": { input: 30.0, output: 60.0 },
	"gpt-3.5-turbo": { input: 0.5, output: 1.5 },
	o1: { input: 15.0, output: 60.0 },
	"o1-mini": { input: 3.0, output: 12.0 },
	"o3-mini": { input: 1.1, output: 4.4 },
	// Anthropic
	"claude-opus-4-6": { input: 15.0, output: 75.0 },
	"claude-sonnet-4-6": { input: 3.0, output: 15.0 },
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
	"claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
	"claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
	// Google
	"gemini-1.5-pro": { input: 1.25, output: 5.0 },
	"gemini-1.5-flash": { input: 0.075, output: 0.3 },
	"gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

/** Calculate cost in USD from token counts and model name */
export function calculateCost(modelName: string, inputTokens: number, outputTokens: number): number {
	const pricing = MODEL_PRICING[modelName];
	if (!pricing) return 0; // Unknown model (e.g. Ollama) — free
	return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export async function getAIModel(): Promise<LanguageModelV3> {
	const provider = await getDefaultProvider();

	// Kayıtlı varsayılan provider yok — env değişkenine geri dön
	if (!provider) {
		return openai("gpt-4o-mini");
	}

	const apiKey = await getRawProviderApiKey(provider.id);
	// Provider'ın model adı boşsa tip bazlı bir varsayılan kullan
	const modelName = provider.model?.trim() || defaultModelForType(provider.type);

	switch (provider.type) {
		case "openai": {
			// baseUrl varsa özel endpoint kullan (Azure OpenAI veya proxy)
			if (provider.baseUrl?.trim()) {
				return createOpenAI({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
			}
			return createOpenAI({ apiKey })(modelName);
		}

		case "anthropic": {
			if (provider.baseUrl?.trim()) {
				return createAnthropic({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
			}
			return createAnthropic({ apiKey })(modelName);
		}

		case "google": {
			if (provider.baseUrl?.trim()) {
				return createGoogleGenerativeAI({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
			}
			return createGoogleGenerativeAI({ apiKey })(modelName);
		}

		case "ollama": {
			// Ollama, OpenAI uyumlu bir API sunar; API anahtarı gerekmez
			const baseURL = provider.baseUrl?.trim() || "http://localhost:11434/v1";
			return createOpenAI({ baseURL, apiKey: "ollama" })(modelName);
		}

		case "custom": {
			// Özel provider — OpenAI uyumlu olduğu varsayılır
			const baseURL = provider.baseUrl?.trim();
			if (baseURL) {
				return createOpenAI({ baseURL, apiKey })(modelName);
			}
			// baseUrl yoksa standart OpenAI endpoint'ini kullan
			return createOpenAI({ apiKey })(modelName);
		}

		default: {
			// Bilinmeyen tip — güvenli varsayılan
			return openai("gpt-4o-mini");
		}
	}
}

/**
 * Provider tipi için makul bir varsayılan model adı döndürür.
 * Kullanıcı modeli boş bıraktığında devreye girer.
 */
function defaultModelForType(type: string): string {
	switch (type) {
		case "openai":
			return "gpt-4o-mini";
		case "anthropic":
			return "claude-3-5-haiku-20241022";
		case "google":
			return "gemini-1.5-flash";
		case "ollama":
			return "llama3.2";
		default:
			return "gpt-4o-mini";
	}
}

/**
 * Herhangi bir AI provider'ın yapılandırılıp yapılandırılmadığını kontrol eder.
 * Hem veritabanındaki varsayılan provider'ı hem de OPENAI_API_KEY env değişkenini
 * denetler.
 */
export async function isAnyProviderConfigured(): Promise<boolean> {
	const dbProvider = await getDefaultProvider();
	if (dbProvider) return true;
	return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// Fallback Chain — birincil model başarısız olursa sıradaki provider'a geç
// ---------------------------------------------------------------------------

/** Belirli bir provider kaydından LanguageModelV3 nesnesi oluşturur. */
async function buildModelFromProvider(provider: AIProvider): Promise<LanguageModelV3> {
	const apiKey = await getRawProviderApiKey(provider.id);
	const modelName = provider.model?.trim() || defaultModelForType(provider.type);

	switch (provider.type) {
		case "openai": {
			if (provider.baseUrl?.trim()) {
				return createOpenAI({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
			}
			return createOpenAI({ apiKey })(modelName);
		}
		case "anthropic": {
			if (provider.baseUrl?.trim()) {
				return createAnthropic({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
			}
			return createAnthropic({ apiKey })(modelName);
		}
		case "google": {
			if (provider.baseUrl?.trim()) {
				return createGoogleGenerativeAI({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
			}
			return createGoogleGenerativeAI({ apiKey })(modelName);
		}
		case "ollama": {
			const baseURL = provider.baseUrl?.trim() || "http://localhost:11434/v1";
			return createOpenAI({ baseURL, apiKey: "ollama" })(modelName);
		}
		case "custom": {
			const baseURL = provider.baseUrl?.trim();
			if (baseURL) {
				return createOpenAI({ baseURL, apiKey })(modelName);
			}
			return createOpenAI({ apiKey })(modelName);
		}
		default:
			return openai("gpt-4o-mini");
	}
}

/**
 * Fallback zinciri ile AI modeli çağrısı yapar.
 *
 * Birincil model başarısız olursa (timeout, rate limit, API hatası) sıradaki
 * aktif provider'a geçer. Maksimum 3 deneme yapılır.
 *
 * @param callFn - Model alıp asenkron işlem yapan fonksiyon. Model başarısız
 *                 olursa hata fırlatmalıdır; fonksiyon başarılı sonucu döndürür.
 *
 * Kullanım örneği:
 * ```ts
 * const result = await getAIModelWithFallback(async (model) => {
 *   return generateText({ model, prompt: '...' });
 * });
 * ```
 */
export async function getAIModelWithFallback<T>(
	callFn: (model: LanguageModelV3, providerInfo: { modelName: string; providerType: string }) => Promise<T>,
): Promise<T> {
	// Maksimum deneme sayısı
	const MAX_ATTEMPTS = 3;

	// Fallback zincirini DB'den al (fallback_order'a göre sıralı, aktif olanlar)
	const chain = await getFallbackChain();

	// Zincir boşsa varsayılan modeli kullan (env tabanlı fallback)
	if (chain.length === 0) {
		const fallbackModel = openai("gpt-4o-mini");
		return callFn(fallbackModel, { modelName: "gpt-4o-mini", providerType: "openai" });
	}

	// Yalnızca ilk MAX_ATTEMPTS provider'ı dene
	const candidates = chain.slice(0, MAX_ATTEMPTS);
	let lastError: unknown;

	for (let i = 0; i < candidates.length; i++) {
		const provider = candidates[i];
		const modelName = provider.model?.trim() || defaultModelForType(provider.type);

		if (i > 0) {
			// Birinci model dışındakilerde fallback log yaz
			console.log(`[AI Fallback] Primary failed, trying fallback: ${modelName} (${provider.name})`);
		}

		try {
			const model = await buildModelFromProvider(provider);
			return await callFn(model, { modelName, providerType: provider.type });
		} catch (err) {
			lastError = err;
			const errMsg = err instanceof Error ? err.message : String(err);
			console.warn(`[AI Fallback] Provider "${provider.name}" (${modelName}) başarısız oldu: ${errMsg}`);
		}
	}

	// Tüm denemeler başarısız oldu — son hatayı yeniden fırlat
	throw lastError;
}

/**
 * Fallback zinciri bilgisiyle birlikte birincil model bilgisini döndürür.
 * Execution engine'de maliyet takibi için kullanılır.
 */
export async function getAIModelInfoWithFallback<T>(
	callFn: (model: LanguageModelV3, providerInfo: { modelName: string; providerType: string }) => Promise<T>,
): Promise<T> {
	return getAIModelWithFallback(callFn);
}
