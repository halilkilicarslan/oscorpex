import { describe, expect, it } from "vitest";
import { calculatorTool } from "../calculator.js";

// The execute function on a Tool created with createTool has the signature:
//   (args: z.infer<T>, options?: ToolExecuteOptions) => ToolExecutionResult<unknown>
// options is omitted throughout as it is not needed for unit tests.

describe("calculatorTool", () => {
	it("exports a tool with the correct name", () => {
		expect(calculatorTool.name).toBe("calculator");
	});

	describe("execute – add", () => {
		it("returns the sum of two positive numbers", async () => {
			const result = await calculatorTool.execute!({ operation: "add", a: 10, b: 5 });
			expect(result).toMatchObject({ result: 15 });
		});

		it("handles negative operands", async () => {
			const result = await calculatorTool.execute!({ operation: "add", a: -3, b: -7 });
			expect(result).toMatchObject({ result: -10 });
		});

		it("adds zero correctly", async () => {
			const result = await calculatorTool.execute!({ operation: "add", a: 42, b: 0 });
			expect(result).toMatchObject({ result: 42 });
		});
	});

	describe("execute – subtract", () => {
		it("returns the difference of two numbers", async () => {
			const result = await calculatorTool.execute!({ operation: "subtract", a: 10, b: 4 });
			expect(result).toMatchObject({ result: 6 });
		});

		it("returns a negative result when b > a", async () => {
			const result = await calculatorTool.execute!({ operation: "subtract", a: 3, b: 8 });
			expect(result).toMatchObject({ result: -5 });
		});
	});

	describe("execute – multiply", () => {
		it("returns the product of two numbers", async () => {
			const result = await calculatorTool.execute!({ operation: "multiply", a: 6, b: 7 });
			expect(result).toMatchObject({ result: 42 });
		});

		it("multiplying by zero yields zero", async () => {
			const result = await calculatorTool.execute!({ operation: "multiply", a: 999, b: 0 });
			expect(result).toMatchObject({ result: 0 });
		});

		it("handles negative multiplier", async () => {
			const result = await calculatorTool.execute!({ operation: "multiply", a: 5, b: -3 });
			expect(result).toMatchObject({ result: -15 });
		});
	});

	describe("execute – divide", () => {
		it("returns the quotient of two numbers", async () => {
			const result = await calculatorTool.execute!({ operation: "divide", a: 20, b: 4 });
			expect(result).toMatchObject({ result: 5 });
		});

		it("returns a decimal result for non-integer division", async () => {
			const result = await calculatorTool.execute!({ operation: "divide", a: 7, b: 2 });
			expect(result).toMatchObject({ result: 3.5 });
		});
	});

	describe("execute – divide by zero", () => {
		it("throws an error when dividing by zero", async () => {
			// The calculator tool throws on division by zero rather than returning
			// an error envelope, keeping behaviour consistent with all other error
			// paths (missing operands, unknown operations, etc.).
			await expect(calculatorTool.execute!({ operation: "divide", a: 10, b: 0 })).rejects.toThrow();
		});

		it("thrown error message mentions 'zero' or 'division'", async () => {
			await expect(calculatorTool.execute!({ operation: "divide", a: 5, b: 0 })).rejects.toThrow(/zero|division/i);
		});
	});

	describe("execute – evaluate expression", () => {
		it("evaluates a simple arithmetic expression string", async () => {
			const result = await calculatorTool.execute!({
				operation: "evaluate",
				expression: "3 + 4 * 2",
			});
			expect(result).toMatchObject({ result: 11 });
		});

		it("respects parentheses in expressions", async () => {
			const result = await calculatorTool.execute!({
				operation: "evaluate",
				expression: "(3 + 4) * 2",
			});
			expect(result).toMatchObject({ result: 14 });
		});
	});
});
