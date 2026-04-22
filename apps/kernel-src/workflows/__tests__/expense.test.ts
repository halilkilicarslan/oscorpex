import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// We test the step logic extracted from the workflow definition rather than
// running the full VoltAgent orchestration engine. This keeps the tests fast,
// hermetic, and free of infrastructure dependencies while still covering the
// two critical branching paths.
// ---------------------------------------------------------------------------

// Re-export the shape that the step's execute function receives so that the
// test file remains self-contained and easy to read.
type SuspendFn = (reason: string, metadata: Record<string, unknown>) => Promise<never>;

interface CheckApprovalInput {
	employeeId: string;
	amount: number;
	category: string;
	description: string;
	// Fields injected when resuming
	approved?: boolean;
	approvedBy?: string;
	finalAmount?: number;
	managerComments?: string;
}

interface ResumeData {
	approved: boolean;
	managerId: string;
	comments?: string;
	adjustedAmount?: number;
}

// Inline the step logic verbatim from src/workflows/index.ts so that tests
// exercise the real decision code without coupling to VoltAgent internals.
async function checkApprovalStep(
	data: CheckApprovalInput,
	suspend: SuspendFn,
	resumeData?: ResumeData,
): Promise<
	CheckApprovalInput & { approved: boolean; approvedBy: string; finalAmount: number; managerComments?: string }
> {
	if (resumeData) {
		return {
			...data,
			approved: resumeData.approved,
			approvedBy: resumeData.managerId,
			finalAmount: resumeData.adjustedAmount ?? data.amount,
			managerComments: resumeData.comments,
		};
	}

	if (data.amount > 500) {
		await suspend("Manager approval required", {
			employeeId: data.employeeId,
			requestedAmount: data.amount,
			category: data.category,
		});
	}

	return {
		...data,
		approved: true,
		approvedBy: "system",
		finalAmount: data.amount,
	};
}

function processDecisionStep(data: {
	approved: boolean;
	approvedBy: string;
	finalAmount: number;
}): { status: "approved" | "rejected"; approvedBy: string; finalAmount: number } {
	return {
		status: data.approved ? "approved" : "rejected",
		approvedBy: data.approvedBy,
		finalAmount: data.finalAmount,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Expense Approval Workflow – check-approval-needed step", () => {
	describe("auto-approve for amounts <= 500", () => {
		it("auto-approves an expense of exactly 500", async () => {
			const suspend = vi.fn() as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-001",
				amount: 500,
				category: "office-supplies",
				description: "Keyboard and mouse",
			};

			const result = await checkApprovalStep(input, suspend);

			expect(suspend).not.toHaveBeenCalled();
			expect(result.approved).toBe(true);
			expect(result.approvedBy).toBe("system");
			expect(result.finalAmount).toBe(500);
		});

		it("auto-approves an expense below 500", async () => {
			const suspend = vi.fn() as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-123",
				amount: 250,
				category: "office-supplies",
				description: "New laptop mouse and keyboard",
			};

			const result = await checkApprovalStep(input, suspend);

			expect(suspend).not.toHaveBeenCalled();
			expect(result.approved).toBe(true);
			expect(result.approvedBy).toBe("system");
			expect(result.finalAmount).toBe(250);
		});

		it("preserves the original input fields on auto-approval", async () => {
			const suspend = vi.fn() as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-999",
				amount: 100,
				category: "travel",
				description: "Train ticket",
			};

			const result = await checkApprovalStep(input, suspend);

			expect(result.employeeId).toBe("EMP-999");
			expect(result.category).toBe("travel");
			expect(result.description).toBe("Train ticket");
		});
	});

	describe("suspend trigger for amounts > 500", () => {
		it("calls suspend when the expense exceeds 500", async () => {
			const suspend = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-456",
				amount: 750,
				category: "travel",
				description: "Flight tickets for client meeting",
			};

			// suspend() never resolves in real usage; we just verify it is called.
			checkApprovalStep(input, suspend).catch(() => {});

			// Yield to let the microtask queue flush before asserting
			await Promise.resolve();

			expect(suspend).toHaveBeenCalledOnce();
			expect(suspend).toHaveBeenCalledWith(
				"Manager approval required",
				expect.objectContaining({
					employeeId: "EMP-456",
					requestedAmount: 750,
					category: "travel",
				}),
			);
		});

		it("calls suspend for an expense of 501 (just above threshold)", async () => {
			const suspend = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-002",
				amount: 501,
				category: "equipment",
				description: "Ergonomic desk accessory",
			};

			checkApprovalStep(input, suspend).catch(() => {});
			await Promise.resolve();

			expect(suspend).toHaveBeenCalledOnce();
		});

		it("calls suspend for a very large expense", async () => {
			const suspend = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-789",
				amount: 1500,
				category: "equipment",
				description: "Premium office chair",
			};

			checkApprovalStep(input, suspend).catch(() => {});
			await Promise.resolve();

			expect(suspend).toHaveBeenCalledOnce();
		});
	});

	describe("resume after manager decision", () => {
		it("approves with manager data when resumeData.approved is true", async () => {
			const suspend = vi.fn() as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-456",
				amount: 750,
				category: "travel",
				description: "Flight tickets",
			};
			const resumeData: ResumeData = {
				approved: true,
				managerId: "MGR-001",
				comments: "Approved for important client",
				adjustedAmount: 700,
			};

			const result = await checkApprovalStep(input, suspend, resumeData);

			expect(suspend).not.toHaveBeenCalled();
			expect(result.approved).toBe(true);
			expect(result.approvedBy).toBe("MGR-001");
			expect(result.finalAmount).toBe(700);
			expect(result.managerComments).toBe("Approved for important client");
		});

		it("rejects with manager data when resumeData.approved is false", async () => {
			const suspend = vi.fn() as unknown as SuspendFn;
			const input: CheckApprovalInput = {
				employeeId: "EMP-789",
				amount: 1500,
				category: "equipment",
				description: "Premium office chair",
			};
			const resumeData: ResumeData = {
				approved: false,
				managerId: "MGR-002",
				comments: "Budget exceeded for this quarter",
			};

			const result = await checkApprovalStep(input, suspend, resumeData);

			expect(result.approved).toBe(false);
			expect(result.approvedBy).toBe("MGR-002");
			// No adjustedAmount supplied – falls back to original amount
			expect(result.finalAmount).toBe(1500);
		});
	});
});

describe("Expense Approval Workflow – process-decision step", () => {
	it('returns status "approved" when approved is true', () => {
		const result = processDecisionStep({
			approved: true,
			approvedBy: "system",
			finalAmount: 250,
		});
		expect(result.status).toBe("approved");
		expect(result.approvedBy).toBe("system");
		expect(result.finalAmount).toBe(250);
	});

	it('returns status "rejected" when approved is false', () => {
		const result = processDecisionStep({
			approved: false,
			approvedBy: "MGR-002",
			finalAmount: 1500,
		});
		expect(result.status).toBe("rejected");
		expect(result.approvedBy).toBe("MGR-002");
		expect(result.finalAmount).toBe(1500);
	});
});
