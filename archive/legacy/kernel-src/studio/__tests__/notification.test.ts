import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------

const mockCreateNotification = vi.fn();

vi.mock("../db.js", () => ({
	createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

import { processEventForNotification } from "../notification-service.js";
import type { StudioEvent } from "../types.js";

function makeEvent(overrides: Partial<StudioEvent>): StudioEvent {
	return {
		id: "evt-1",
		projectId: "proj-1",
		type: "task:completed",
		taskId: "task-1",
		agentId: "agent-1",
		payload: {},
		createdAt: new Date().toISOString(),
		...overrides,
	} as StudioEvent;
}

describe("notification-service — processEventForNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateNotification.mockResolvedValue({
			id: "notif-1",
			tenantId: null,
			userId: null,
			projectId: "proj-1",
			type: "task_completed",
			title: "Task completed: Build UI",
			body: 'Agent finished task "Build UI" successfully.',
			read: false,
			data: {},
			createdAt: new Date().toISOString(),
		});
	});

	it("task:completed olayinda notification olusturmali", async () => {
		const event = makeEvent({
			type: "task:completed",
			payload: { title: "Build UI" },
		});

		const result = await processEventForNotification(event);

		expect(mockCreateNotification).toHaveBeenCalledOnce();
		expect(mockCreateNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "proj-1",
				type: "task_completed",
				title: expect.stringContaining("Build UI"),
			}),
		);
		expect(result).not.toBeNull();
	});

	it("task:failed olayinda hata bilgisiyle notification olusturmali", async () => {
		mockCreateNotification.mockResolvedValue({
			id: "notif-2",
			type: "task_failed",
			title: "Task failed: API tests",
			body: 'Task "API tests" failed: timeout',
			read: false,
			data: {},
			createdAt: new Date().toISOString(),
		});

		const event = makeEvent({
			type: "task:failed",
			payload: { title: "API tests", error: "timeout" },
		});

		await processEventForNotification(event);

		expect(mockCreateNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "task_failed",
				title: expect.stringContaining("API tests"),
				body: expect.stringContaining("timeout"),
			}),
		);
	});

	it("pipeline:completed olayinda notification olusturmali", async () => {
		mockCreateNotification.mockResolvedValue({
			id: "notif-3",
			type: "pipeline_completed",
			title: "Pipeline completed",
			read: false,
			data: {},
			createdAt: new Date().toISOString(),
		});

		const event = makeEvent({
			type: "pipeline:completed",
			payload: {},
		});

		await processEventForNotification(event);

		expect(mockCreateNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "pipeline_completed",
				title: "Pipeline completed",
			}),
		);
	});

	it("tanimlanmamis event turunde null donmeli", async () => {
		const event = makeEvent({
			type: "task:started" as StudioEvent["type"],
			payload: {},
		});

		const result = await processEventForNotification(event);

		expect(result).toBeNull();
		expect(mockCreateNotification).not.toHaveBeenCalled();
	});

	it("event payload taskTitle fallback kullanmali", async () => {
		const event = makeEvent({
			type: "task:completed",
			payload: { taskTitle: "Fallback Title" },
		});

		await processEventForNotification(event);

		expect(mockCreateNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				title: expect.stringContaining("Fallback Title"),
			}),
		);
	});

	it("notification data eventId ve eventType icermeli", async () => {
		const event = makeEvent({
			type: "task:completed",
			payload: { title: "Test" },
		});

		await processEventForNotification(event);

		expect(mockCreateNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					eventId: "evt-1",
					eventType: "task:completed",
				}),
			}),
		);
	});

	it("tenantId ve userId null olmali (broadcast)", async () => {
		const event = makeEvent({
			type: "task:completed",
			payload: { title: "Test" },
		});

		await processEventForNotification(event);

		expect(mockCreateNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: null,
				userId: null,
			}),
		);
	});
});
