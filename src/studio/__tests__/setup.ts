import { afterAll } from "vitest";
import { closePool } from "../pg.js";

// Use a test database — override via DATABASE_URL env var
// Default: oscorpex_test on localhost
process.env.DATABASE_URL =
	process.env.DATABASE_URL || "postgresql://oscorpex:oscorpex_dev@localhost:5432/oscorpex_test";

afterAll(async () => {
	await closePool();
});
