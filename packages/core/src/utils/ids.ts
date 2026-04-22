// @oscorpex/core — ID generation utility
// Uses node:crypto randomUUID for canonical ID generation.

import { randomUUID } from "node:crypto";

export function generateId(): string {
	return randomUUID();
}

export function parseId(id: string): { valid: boolean; timestamp?: number } {
	if (!id || typeof id !== "string") return { valid: false };
	if (id.length !== 36) return { valid: false };
	if (id.split("-").length !== 5) return { valid: false };
	return { valid: true };
}

export function isId(value: unknown): value is string {
	return typeof value === "string" && value.length === 36 && value.split("-").length === 5;
}