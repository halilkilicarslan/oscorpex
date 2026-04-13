import { createTool } from "@voltagent/core";
import { z } from "zod";

/**
 * A tool for performing arithmetic calculations and evaluating mathematical expressions.
 * Supports basic operations (add, subtract, multiply, divide) via a/b parameters,
 * and safe expression evaluation without using eval().
 */
export const calculatorTool = createTool({
	name: "calculator",
	description:
		"Perform arithmetic calculations. Use 'add', 'subtract', 'multiply', or 'divide' with numeric a/b values, or use 'evaluate' with an expression string like '3 + 4 * 2'.",
	parameters: z.object({
		operation: z
			.enum(["add", "subtract", "multiply", "divide", "evaluate"])
			.describe("The operation to perform. Use 'evaluate' to parse a full expression string."),
		expression: z
			.string()
			.optional()
			.describe("A mathematical expression string (e.g. '3 + 4 * 2'). Required when operation is 'evaluate'."),
		a: z.number().optional().describe("The first operand. Required for add/subtract/multiply/divide."),
		b: z.number().optional().describe("The second operand. Required for add/subtract/multiply/divide."),
	}),
	execute: async ({ operation, expression, a, b }) => {
		if (operation === "evaluate") {
			if (!expression) {
				throw new Error("'expression' is required when operation is 'evaluate'.");
			}

			const result = safeEvaluate(expression);

			return {
				result,
				expression,
			};
		}

		// Basic operations require a and b
		if (a === undefined || b === undefined) {
			throw new Error(`Both 'a' and 'b' are required for the '${operation}' operation.`);
		}

		let result: number;
		let builtExpression: string;

		switch (operation) {
			case "add":
				result = a + b;
				builtExpression = `${a} + ${b}`;
				break;
			case "subtract":
				result = a - b;
				builtExpression = `${a} - ${b}`;
				break;
			case "multiply":
				result = a * b;
				builtExpression = `${a} * ${b}`;
				break;
			case "divide":
				if (b === 0) {
					throw new Error("Division by zero is not allowed.");
				}
				result = a / b;
				builtExpression = `${a} / ${b}`;
				break;
			default:
				// TypeScript exhaustive check — should never reach here
				throw new Error(`Unknown operation: ${operation}`);
		}

		return {
			result,
			expression: builtExpression,
		};
	},
});

/**
 * Safely evaluates a mathematical expression string without using eval().
 * Supports: +, -, *, /, (, ), integers, and decimals.
 * Throws on invalid or potentially unsafe input.
 */
function safeEvaluate(expression: string): number {
	// Validate the expression only contains safe characters
	const sanitized = expression.replace(/\s+/g, "");
	if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
		throw new Error(
			`Invalid expression: '${expression}'. Only numbers and operators (+, -, *, /, parentheses) are allowed.`,
		);
	}

	// Recursive-descent parser
	const tokens = tokenize(sanitized);
	const parser = createParser(tokens);
	const result = parser.parseExpression();

	if (!parser.isEnd()) {
		throw new Error(`Unexpected token in expression: '${expression}'.`);
	}

	return result;
}

type Token =
	| { type: "number"; value: number }
	| { type: "op"; value: "+" | "-" | "*" | "/" }
	| { type: "paren"; value: "(" | ")" };

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < input.length) {
		const char = input[i];

		if (/[0-9.]/.test(char)) {
			let num = "";
			while (i < input.length && /[0-9.]/.test(input[i])) {
				num += input[i++];
			}
			tokens.push({ type: "number", value: Number.parseFloat(num) });
		} else if (char === "+" || char === "-" || char === "*" || char === "/") {
			tokens.push({ type: "op", value: char });
			i++;
		} else if (char === "(" || char === ")") {
			tokens.push({ type: "paren", value: char });
			i++;
		} else {
			throw new Error(`Unexpected character: '${char}'.`);
		}
	}

	return tokens;
}

function createParser(tokens: Token[]) {
	let pos = 0;

	function peek(): Token | undefined {
		return tokens[pos];
	}

	function consume(): Token {
		const token = tokens[pos++];
		if (!token) throw new Error("Unexpected end of expression.");
		return token;
	}

	function isEnd(): boolean {
		return pos >= tokens.length;
	}

	// expression = term (('+' | '-') term)*
	function parseExpression(): number {
		let left = parseTerm();

		while (!isEnd()) {
			const token = peek();
			if (token?.type === "op" && (token.value === "+" || token.value === "-")) {
				consume();
				const right = parseTerm();
				left = token.value === "+" ? left + right : left - right;
			} else {
				break;
			}
		}

		return left;
	}

	// term = factor (('*' | '/') factor)*
	function parseTerm(): number {
		let left = parseFactor();

		while (!isEnd()) {
			const token = peek();
			if (token?.type === "op" && (token.value === "*" || token.value === "/")) {
				consume();
				const right = parseFactor();
				if (token.value === "/" && right === 0) {
					throw new Error("Division by zero is not allowed.");
				}
				left = token.value === "*" ? left * right : left / right;
			} else {
				break;
			}
		}

		return left;
	}

	// factor = number | '(' expression ')' | unary minus
	function parseFactor(): number {
		const token = peek();

		if (!token) {
			throw new Error("Unexpected end of expression.");
		}

		// Unary minus
		if (token.type === "op" && token.value === "-") {
			consume();
			return -parseFactor();
		}

		// Unary plus
		if (token.type === "op" && token.value === "+") {
			consume();
			return parseFactor();
		}

		if (token.type === "number") {
			consume();
			return token.value;
		}

		if (token.type === "paren" && token.value === "(") {
			consume(); // consume '('
			const value = parseExpression();
			const closing = consume();
			if (closing.type !== "paren" || closing.value !== ")") {
				throw new Error("Expected closing parenthesis ')'.");
			}
			return value;
		}

		throw new Error(`Unexpected token: '${JSON.stringify(token)}'.`);
	}

	return { parseExpression, isEnd };
}
