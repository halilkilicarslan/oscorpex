import { describe, expect, it } from "vitest";
import { dateTimeTool } from "../datetime.js";

// Narrow the return type coming back from execute for easier assertions.
type DateTimeResult = { result: string; timestamp: number };

async function exec(args: Parameters<NonNullable<typeof dateTimeTool.execute>>[0]): Promise<DateTimeResult> {
	if (!dateTimeTool.execute) {
		throw new Error("dateTimeTool.execute is not defined");
	}
	return dateTimeTool.execute(args) as Promise<DateTimeResult>;
}

describe("dateTimeTool", () => {
	it("exports a tool with the correct name", () => {
		expect(dateTimeTool.name).toBe("dateTime");
	});

	// ---------------------------------------------------------------------------
	// action: now
	// ---------------------------------------------------------------------------
	describe('execute – action "now"', () => {
		it("returns a result string and a numeric timestamp", async () => {
			const { result, timestamp } = await exec({ action: "now" });
			expect(typeof result).toBe("string");
			expect(typeof timestamp).toBe("number");
		});

		it("returns a timestamp close to the current time", async () => {
			const before = Date.now();
			const { timestamp } = await exec({ action: "now" });
			const after = Date.now();
			// Allow a 5-second window for any async overhead
			expect(timestamp).toBeGreaterThanOrEqual(before - 5_000);
			expect(timestamp).toBeLessThanOrEqual(after + 5_000);
		});

		it("result string is a non-empty formatted date", async () => {
			const { result } = await exec({ action: "now" });
			expect(result.length).toBeGreaterThan(0);
		});

		it("honours a timezone parameter and includes the tz abbreviation", async () => {
			const { result } = await exec({ action: "now", timezone: "America/New_York" });
			// Intl.DateTimeFormat with timeZoneName:"short" appends EDT or EST
			expect(result).toMatch(/E[SD]T/);
		});
	});

	// ---------------------------------------------------------------------------
	// action: convert
	// ---------------------------------------------------------------------------
	describe('execute – action "convert"', () => {
		it("converts a UTC timestamp to Eastern Standard Time (UTC-5)", async () => {
			// 2024-01-15 12:00 UTC => 07:00 EST
			const { result } = await exec({
				action: "convert",
				date: "2024-01-15T12:00:00Z",
				timezone: "America/New_York",
			});
			// Hour "07" must appear in the formatted string
			expect(result).toMatch(/07/);
		});

		it("result contains timezone abbreviation for the target zone", async () => {
			const { result } = await exec({
				action: "convert",
				date: "2024-06-01T08:00:00Z",
				timezone: "Europe/London",
			});
			// BST or GMT should appear
			expect(result).toMatch(/BST|GMT/);
		});

		it("returns the correct unix timestamp for the converted date", async () => {
			const isoDate = "2024-03-20T00:00:00Z";
			const { timestamp } = await exec({
				action: "convert",
				date: isoDate,
				timezone: "Asia/Tokyo",
			});
			expect(timestamp).toBe(new Date(isoDate).getTime());
		});

		it("throws when 'date' is not provided", async () => {
			await expect(exec({ action: "convert" })).rejects.toThrow(/'date' is required/);
		});
	});

	// ---------------------------------------------------------------------------
	// action: add
	// ---------------------------------------------------------------------------
	describe('execute – action "add"', () => {
		it("adds the specified number of days to a fixed date", async () => {
			const { result } = await exec({
				action: "add",
				date: "2024-01-10T00:00:00Z",
				amount: 5,
				unit: "days",
			});
			// 10 + 5 = 15 January 2024
			expect(result).toMatch(/01\/15\/2024/);
		});

		it("correctly crosses a month boundary when adding days", async () => {
			const { result } = await exec({
				action: "add",
				date: "2024-01-28T00:00:00Z",
				amount: 5,
				unit: "days",
			});
			// 28 + 5 = Feb 2nd (2024 is a leap year, but we only need the 2nd)
			expect(result).toMatch(/02\/02\/2024/);
		});

		it("adding zero days returns the same date", async () => {
			const { result } = await exec({
				action: "add",
				date: "2024-05-20T00:00:00Z",
				amount: 0,
				unit: "days",
			});
			expect(result).toMatch(/05\/20\/2024/);
		});

		it("adds hours to a date", async () => {
			const base = new Date("2024-06-01T10:00:00Z");
			const { timestamp } = await exec({
				action: "add",
				date: base.toISOString(),
				amount: 3,
				unit: "hours",
			});
			expect(timestamp).toBe(base.getTime() + 3 * 3_600_000);
		});

		it("adds minutes to a date", async () => {
			const base = new Date("2024-06-01T10:00:00Z");
			const { timestamp } = await exec({
				action: "add",
				date: base.toISOString(),
				amount: 90,
				unit: "minutes",
			});
			expect(timestamp).toBe(base.getTime() + 90 * 60_000);
		});

		it("throws when 'amount' is not provided", async () => {
			await expect(exec({ action: "add", date: "2024-01-01T00:00:00Z", unit: "days" })).rejects.toThrow(
				/'amount' is required/,
			);
		});

		it("throws when 'unit' is not provided", async () => {
			await expect(exec({ action: "add", date: "2024-01-01T00:00:00Z", amount: 5 })).rejects.toThrow(
				/'unit' is required/,
			);
		});
	});
});
