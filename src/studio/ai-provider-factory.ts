// ---------------------------------------------------------------------------
// AI Dev Studio — AI Model Factory
// Yapılandırılmış provider tablosuna göre doğru AI SDK modelini döndürür.
// ---------------------------------------------------------------------------

import { openai, createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { getDefaultProvider, getRawProviderApiKey } from './db.js';

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
export function getAIModel(): LanguageModelV3 {
  const provider = getDefaultProvider();

  // Kayıtlı varsayılan provider yok — env değişkenine geri dön
  if (!provider) {
    return openai('gpt-4o-mini');
  }

  const apiKey = getRawProviderApiKey(provider.id);
  // Provider'ın model adı boşsa tip bazlı bir varsayılan kullan
  const modelName = provider.model?.trim() || defaultModelForType(provider.type);

  switch (provider.type) {
    case 'openai': {
      // baseUrl varsa özel endpoint kullan (Azure OpenAI veya proxy)
      if (provider.baseUrl?.trim()) {
        return createOpenAI({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
      }
      return createOpenAI({ apiKey })(modelName);
    }

    case 'anthropic': {
      if (provider.baseUrl?.trim()) {
        return createAnthropic({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
      }
      return createAnthropic({ apiKey })(modelName);
    }

    case 'google': {
      if (provider.baseUrl?.trim()) {
        return createGoogleGenerativeAI({ apiKey, baseURL: provider.baseUrl.trim() })(modelName);
      }
      return createGoogleGenerativeAI({ apiKey })(modelName);
    }

    case 'ollama': {
      // Ollama, OpenAI uyumlu bir API sunar; API anahtarı gerekmez
      const baseURL = provider.baseUrl?.trim() || 'http://localhost:11434/v1';
      return createOpenAI({ baseURL, apiKey: 'ollama' })(modelName);
    }

    case 'custom': {
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
      return openai('gpt-4o-mini');
    }
  }
}

/**
 * Provider tipi için makul bir varsayılan model adı döndürür.
 * Kullanıcı modeli boş bıraktığında devreye girer.
 */
function defaultModelForType(type: string): string {
  switch (type) {
    case 'openai':    return 'gpt-4o-mini';
    case 'anthropic': return 'claude-3-5-haiku-20241022';
    case 'google':    return 'gemini-1.5-flash';
    case 'ollama':    return 'llama3.2';
    default:          return 'gpt-4o-mini';
  }
}

/**
 * Herhangi bir AI provider'ın yapılandırılıp yapılandırılmadığını kontrol eder.
 * Hem veritabanındaki varsayılan provider'ı hem de OPENAI_API_KEY env değişkenini
 * denetler.
 */
export function isAnyProviderConfigured(): boolean {
  const dbProvider = getDefaultProvider();
  if (dbProvider) return true;
  return !!process.env.OPENAI_API_KEY;
}
