// ---------------------------------------------------------------------------
// Oscorpex — AI Model Factory
// Yapılandırılmış provider tablosuna göre doğru AI SDK modelini döndürür.
// ---------------------------------------------------------------------------

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { CliLanguageModel, defaultModelForCliTool } from "./cli-language-model.js";
import { getDefaultProvider, getFallbackChain, getRawProviderApiKey } from "./db.js";
import type { AIProvider } from "./types.js";
import { calculateCost } from "@oscorpex/provider-sdk";
import { createLogger } from "./logger.js";
const log = createLogger("ai-provider-factory");

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
		case "cli":
			return "sonnet";
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
		case "cli": {
			const cliTool = provider.cliTool ?? "claude";
			const effectiveModel = provider.model?.trim() || defaultModelForCliTool(cliTool);
			return new CliLanguageModel(cliTool, effectiveModel);
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
			log.info(`[AI Fallback] Primary failed, trying fallback: ${modelName} (${provider.name})`);
		}

		try {
			const model = await buildModelFromProvider(provider);
			return await callFn(model, { modelName, providerType: provider.type });
		} catch (err) {
			lastError = err;
			const errMsg = err instanceof Error ? err.message : String(err);
			log.warn(`[AI Fallback] Provider "${provider.name}" (${modelName}) başarısız oldu: ${errMsg}`);
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
