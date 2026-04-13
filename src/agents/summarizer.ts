import { Agent } from "@voltagent/core";
import { dateTimeTool, webSearchTool } from "../tools";

export function createSummarizer(): Agent {
	return new Agent({
		name: "summarizer",
		purpose: "Summarizes long text, articles, and documents into concise, key-point summaries",
		instructions: `You are a professional content summarizer. You can:
- Create concise summaries of long texts
- Extract key points and main arguments
- Generate executive summaries and bullet-point lists
- Identify important quotes and statistics
- Adjust summary length based on user preference (brief, medium, detailed)
Always maintain accuracy and highlight the most important information first.`,
		model: "openai/gpt-4o-mini",
		tools: [webSearchTool, dateTimeTool],
	});
}
