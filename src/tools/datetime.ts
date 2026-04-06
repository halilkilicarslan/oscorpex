import { createTool } from "@voltagent/core";
import { z } from "zod";

/**
 * A tool for common date and time operations using only built-in
 * JavaScript Intl and Date APIs — no external dependencies.
 *
 * Supported actions:
 *  - now        → current date/time, optionally formatted in a given timezone
 *  - convert    → convert an ISO date string to a target timezone
 *  - add        → add an amount of days/hours/minutes to a date (or now)
 *  - difference → compute the difference between two dates
 */
export const dateTimeTool = createTool({
  name: "dateTime",
  description:
    "Perform date and time operations: get the current time, convert between timezones, add time units to a date, or calculate the difference between two dates.",
  parameters: z.object({
    action: z
      .enum(["now", "convert", "add", "difference"])
      .describe(
        "The date/time action to perform: 'now', 'convert', 'add', or 'difference'."
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        "An IANA timezone identifier (e.g. 'America/New_York', 'Europe/London'). Used for 'now' and 'convert' actions."
      ),
    date: z
      .string()
      .optional()
      .describe(
        "An ISO 8601 date string (e.g. '2025-06-15T12:00:00Z'). For 'difference', provide two dates separated by a comma: 'date1,date2'. Required for 'convert'; optional for 'add' (defaults to now)."
      ),
    amount: z
      .number()
      .optional()
      .describe(
        "The amount of time units to add. Required for the 'add' action."
      ),
    unit: z
      .enum(["days", "hours", "minutes"])
      .optional()
      .describe(
        "The time unit for the 'add' action: 'days', 'hours', or 'minutes'."
      ),
  }),
  execute: async ({ action, timezone, date, amount, unit }) => {
    switch (action) {
      case "now": {
        const now = new Date();
        const result = formatDate(now, timezone);
        return { result, timestamp: now.getTime() };
      }

      case "convert": {
        if (!date) {
          throw new Error("'date' is required for the 'convert' action.");
        }
        const parsed = parseDate(date);
        const result = formatDate(parsed, timezone);
        return { result, timestamp: parsed.getTime() };
      }

      case "add": {
        if (amount === undefined) {
          throw new Error("'amount' is required for the 'add' action.");
        }
        if (!unit) {
          throw new Error("'unit' is required for the 'add' action.");
        }

        const base = date ? parseDate(date) : new Date();
        const ms = toMilliseconds(amount, unit);
        const resultDate = new Date(base.getTime() + ms);
        const result = formatDate(resultDate, timezone);

        return { result, timestamp: resultDate.getTime() };
      }

      case "difference": {
        if (!date) {
          throw new Error(
            "'date' is required for the 'difference' action. Provide two ISO dates separated by a comma."
          );
        }

        const parts = date.split(",").map((s) => s.trim());
        if (parts.length !== 2) {
          throw new Error(
            "For the 'difference' action, 'date' must contain exactly two ISO date strings separated by a comma."
          );
        }

        const [dateA, dateB] = parts as [string, string];
        const d1 = parseDate(dateA);
        const d2 = parseDate(dateB);
        const diffMs = Math.abs(d2.getTime() - d1.getTime());

        const totalMinutes = Math.floor(diffMs / 60_000);
        const totalHours = Math.floor(diffMs / 3_600_000);
        const totalDays = Math.floor(diffMs / 86_400_000);

        const remainingHours = totalHours % 24;
        const remainingMinutes = totalMinutes % 60;

        const result =
          `${totalDays} day(s), ${remainingHours} hour(s), ${remainingMinutes} minute(s)` +
          ` (${diffMs} ms total)`;

        return { result, timestamp: diffMs };
      }

      default: {
        // TypeScript exhaustive check — should never reach here
        const _exhaustive: never = action;
        throw new Error(`Unknown action: ${_exhaustive}`);
      }
    }
  },
});

/**
 * Formats a Date object into a human-readable locale string.
 * If a timezone is provided, it is applied via Intl.DateTimeFormat.
 * Falls back to UTC if the timezone identifier is invalid.
 */
function formatDate(date: Date, timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  };

  if (timezone) {
    // Validate the timezone identifier before using it
    try {
      Intl.DateTimeFormat("en-US", { timeZone: timezone });
      options.timeZone = timezone;
    } catch {
      throw new Error(
        `Invalid timezone identifier: '${timezone}'. Use an IANA timezone name like 'America/New_York'.`
      );
    }
  }

  return new Intl.DateTimeFormat("en-US", options).format(date);
}

/**
 * Parses an ISO 8601 date string into a Date object.
 * Throws a descriptive error if the string is not a valid date.
 */
function parseDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(
      `Invalid date string: '${dateStr}'. Please provide an ISO 8601 formatted date (e.g. '2025-06-15T12:00:00Z').`
    );
  }
  return date;
}

/**
 * Converts an amount and unit pair into milliseconds.
 */
function toMilliseconds(amount: number, unit: "days" | "hours" | "minutes"): number {
  switch (unit) {
    case "days":
      return amount * 86_400_000;
    case "hours":
      return amount * 3_600_000;
    case "minutes":
      return amount * 60_000;
  }
}
