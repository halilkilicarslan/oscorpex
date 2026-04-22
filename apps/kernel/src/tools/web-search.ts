import { createTool } from "@voltagent/core";
import { z } from "zod";

/**
 * Shape of a single search result returned to the caller.
 */
interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/**
 * Minimal subset of the DuckDuckGo Instant Answer API response we care about.
 * The full API returns many more fields; we only type what we use.
 */
interface DuckDuckGoResponse {
	Abstract?: string;
	AbstractURL?: string;
	AbstractText?: string;
	Heading?: string;
	RelatedTopics?: Array<
		| {
				Text?: string;
				FirstURL?: string;
				Result?: string;
				Topics?: undefined;
		  }
		| {
				Topics?: Array<{
					Text?: string;
					FirstURL?: string;
					Result?: string;
				}>;
				Name?: string;
				Text?: undefined;
				FirstURL?: undefined;
		  }
	>;
}

/**
 * A tool for searching the web via the DuckDuckGo Instant Answer API.
 * Uses native fetch — no external HTTP libraries required.
 *
 * Note: The DuckDuckGo Instant Answer API is free and requires no API key,
 * but it returns structured knowledge-graph data rather than a list of web
 * search results. Responses are best for well-known entities and topics.
 */
export const webSearchTool = createTool({
	name: "webSearch",
	description:
		"Search the web using DuckDuckGo's Instant Answer API and return a list of relevant results with titles, URLs, and snippets.",
	parameters: z.object({
		query: z.string().describe("The search query string."),
		numResults: z
			.number()
			.int()
			.min(1)
			.max(20)
			.default(5)
			.describe("The maximum number of results to return (1–20, default 5)."),
	}),
	execute: async ({ query, numResults }) => {
		const url = buildApiUrl(query);

		let rawData: DuckDuckGoResponse;

		try {
			const response = await fetch(url, {
				headers: {
					// DuckDuckGo recommends a descriptive User-Agent
					"User-Agent": "VoltAgent/1.0 (webSearchTool; +https://voltagent.dev)",
				},
			});

			if (!response.ok) {
				throw new Error(`DuckDuckGo API responded with HTTP ${response.status}: ${response.statusText}`);
			}

			rawData = (await response.json()) as DuckDuckGoResponse;
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Web search failed: ${error.message}`);
			}
			throw new Error("Web search failed due to an unknown error.");
		}

		const results = extractResults(rawData, numResults);

		return {
			results,
			query,
		};
	},
});

/**
 * Builds the DuckDuckGo Instant Answer API URL for a given query.
 */
function buildApiUrl(query: string): string {
	const params = new URLSearchParams({
		q: query,
		format: "json",
		no_html: "1",
		skip_disambig: "1",
	});
	return `https://api.duckduckgo.com/?${params.toString()}`;
}

/**
 * Extracts a flat list of SearchResult objects from a DuckDuckGoResponse.
 * Pulls from the Abstract first, then walks RelatedTopics (including nested
 * topic groups) until the requested number of results is reached.
 */
function extractResults(data: DuckDuckGoResponse, limit: number): SearchResult[] {
	const results: SearchResult[] = [];

	// Primary abstract result
	if (data.AbstractURL && data.Heading) {
		results.push({
			title: data.Heading,
			url: data.AbstractURL,
			snippet: data.AbstractText ?? data.Abstract ?? "",
		});
	}

	// Walk RelatedTopics to fill remaining slots
	if (data.RelatedTopics) {
		for (const topic of data.RelatedTopics) {
			if (results.length >= limit) break;

			// Flat topic entry
			if (topic.FirstURL && topic.Text) {
				results.push({
					title: extractTitle(topic.Text, topic.Result),
					url: topic.FirstURL,
					snippet: stripHtml(topic.Text),
				});
				continue;
			}

			// Topic group — flatten children
			if (topic.Topics) {
				for (const sub of topic.Topics) {
					if (results.length >= limit) break;
					if (sub.FirstURL && sub.Text) {
						results.push({
							title: extractTitle(sub.Text, sub.Result),
							url: sub.FirstURL,
							snippet: stripHtml(sub.Text),
						});
					}
				}
			}
		}
	}

	return results.slice(0, limit);
}

/**
 * Attempts to parse a clean title from the DuckDuckGo result HTML snippet
 * or falls back to the first sentence of the plain text.
 */
function extractTitle(text: string, resultHtml?: string): string {
	// DuckDuckGo wraps entity names in <a> tags in the Result field
	if (resultHtml) {
		const match = /<a[^>]*>([^<]+)<\/a>/i.exec(resultHtml);
		if (match?.[1]) {
			return match[1].trim();
		}
	}

	// Fall back: use the text up to the first " - " separator or first sentence
	const separator = text.indexOf(" - ");
	if (separator !== -1) {
		return text.slice(0, separator).trim();
	}

	const sentence = text.split(/[.!?]/)[0];
	return (sentence ?? text).trim().slice(0, 100);
}

/**
 * Strips HTML tags from a string, returning clean plain text.
 */
function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, "").trim();
}
