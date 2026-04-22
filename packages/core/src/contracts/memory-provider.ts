// @oscorpex/core — MemoryProvider contract
// Interface for building context packets for agent prompts.

import type { ContextPacket, ContextPacketOptions } from "../domain/memory.js";

export interface MemoryProvider {
	buildContextPacket(options: ContextPacketOptions): Promise<ContextPacket>;
}