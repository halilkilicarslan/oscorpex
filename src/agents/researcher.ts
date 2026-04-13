import { Agent } from "@voltagent/core";
import type { Memory } from "@voltagent/core";

export const createResearcherAgent = (memory: Memory): Agent =>
	new Agent({
		name: "researcher",
		instructions: `You are a research specialist. Your role is to:
- Search for information on given topics
- Summarize findings concisely
- Provide sources when available
- Compare different perspectives

Focus on accuracy and cite your sources. Present findings in a structured format.`,
		model: "openai/gpt-4o-mini",
		tools: [], // will be injected
		memory,
	});
