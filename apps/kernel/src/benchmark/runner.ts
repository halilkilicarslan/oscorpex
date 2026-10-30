import { readFile, appendFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createProviderAdapter } from "../studio/kernel/provider-registry.js";

async function main() {
  const [promptFile, workdir, model, provider, outputDir] = process.argv.slice(2);
  if (!promptFile || !workdir || !model || !provider || !outputDir) {
    throw new Error("Usage: runner.ts PROMPT_FILE WORKDIR MODEL PROVIDER OUTPUT_DIR");
  }
  const repoPath = await realpath(resolve(workdir));
  const prompt = await readFile(promptFile, "utf8");
  const emit = (value: object) => appendFile(resolve(outputDir, "events.jsonl"), JSON.stringify(value) + "\n");
  const adapter = createProviderAdapter({ id: provider });
  if (!(await adapter.isAvailable())) throw new Error("Provider unavailable: " + provider);
  const runId = randomUUID();
  const taskId = randomUUID();
  const start = Date.now();
  await emit({ type: "oscorpex.start", runId, taskId, provider, model });
  try {
    const result = await adapter.execute({
      runId, taskId, provider, repoPath, prompt, model,
      timeoutMs: Number(process.env.OSCORPEX_BENCH_TIMEOUT_MS ?? "600000"),
      onLog: (line: string) => process.stderr.write(line + "\n"),
    });
    await emit({
      type: "oscorpex.result", runId, taskId, provider: result.provider,
      model: result.model ?? model, durationMs: Date.now() - start,
      usage: result.usage ?? null, filesCreated: result.filesCreated,
      filesModified: result.filesModified, executionCompleted: true,
    });
  } catch (error) {
    await emit({ type: "oscorpex.error", runId, taskId, error: String(error) });
    throw error;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
