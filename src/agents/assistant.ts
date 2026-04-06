import { Agent } from "@voltagent/core";
import type { Memory } from "@voltagent/core";

export const createAssistantAgent = (memory: Memory): Agent =>
  new Agent({
    name: "assistant",
    instructions: `You are a helpful AI assistant. You can:
- Check real-time weather for any city worldwide
- Perform calculations and math operations
- Get current date/time in any timezone
- Search the web for information

Always be concise and accurate. If you're unsure about something, say so.
When using tools, explain what you're doing and present results clearly.`,
    model: "openai/gpt-4o-mini",
    tools: [], // will be injected from index.ts
    memory,
  });
