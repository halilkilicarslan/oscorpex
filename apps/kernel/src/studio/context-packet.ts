// ---------------------------------------------------------------------------
// Oscorpex — Context Packet Builder (v3.6)
// Thin wrapper around KernelMemoryProvider.
// All assembly logic lives in kernel/memory-adapter.ts; this module only
// emits the prompt:size telemetry event for backward compatibility.
// ---------------------------------------------------------------------------

import { estimateTokens } from "@oscorpex/memory-kit";
import { eventBus } from "./event-bus.js";
import { memoryProvider } from "./kernel/memory-adapter.js";
import type { ContextPacketOptions } from "./types.js";
import { createLogger } from "./logger.js";
const log = createLogger("context-packet");

/**
 * Assembles an optimized context packet for an AI prompt based on the given mode.
 * Delegates to KernelMemoryProvider; emits a `prompt:size` event with block-level
 * token breakdown via eventBus.
 */
export async function buildContextPacket(options: ContextPacketOptions): Promise<string> {
	const { projectId, taskId, agentId, mode, maxTokens = 40_000 } = options;

	try {
		const packet = await memoryProvider.buildContextPacket({ projectId, taskId, agentId, mode, maxTokens });

		eventBus.emitTransient({
			projectId,
			type: "prompt:size",
			agentId,
			taskId,
			payload: {
				mode,
				totalTokens: packet.tokenEstimate,
				totalChars: packet.text.length,
				sections: packet.sections,
				maxTokens,
				overBudget: packet.tokenEstimate > maxTokens,
			},
		});

		return packet.text;
	} catch (err) {
		log.warn(`[context-packet] Failed to build packet (${mode}): ${String(err)}`);
		throw err;
	}
}