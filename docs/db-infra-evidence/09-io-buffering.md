# IO / Buffering Stability (EPIC 9)

**Scope**: `cli-runtime.ts` stdout/stderr handling

---

## Current Buffering Approach

**File**: `cli-runtime.ts`

```typescript
// Typical pattern:
const child = spawn(binary, args, { env });
let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

child.on("close", (code) => {
  // stdout and stderr are fully buffered in memory
});
```

**Risk**: stdout and stderr are accumulated as strings in memory. For very large outputs (e.g., 10MB+), this could cause:
- Memory pressure
- Event loop blocking during string concatenation
- OOM if multiple large outputs run concurrently

---

## Large Output Threshold

**Current**: No threshold. All output is buffered regardless of size.

**Recommended**: Add a size limit with streaming fallback.

```typescript
const MAX_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB

child.stdout.on("data", (chunk) => {
  if (stdout.length + chunk.length > MAX_BUFFER_SIZE) {
    child.kill(); // or switch to streaming mode
    return;
  }
  stdout += chunk;
});
```

---

## Stream Handling Review

### Option 1: String Buffering (Current)
- ✅ Simple
- ✅ Easy to parse full output
- ❌ Memory unbounded
- ❌ String concatenation is O(n²)

### Option 2: Buffer Array + Join
```typescript
const chunks: Buffer[] = [];
child.stdout.on("data", (chunk) => chunks.push(chunk));
const stdout = Buffer.concat(chunks).toString();
```
- ✅ Faster concatenation
- ✅ Still buffers everything
- ❌ Still memory unbounded

### Option 3: Streaming with Size Limit
```typescript
const maxSize = 5 * 1024 * 1024;
let size = 0;
const chunks: Buffer[] = [];

child.stdout.on("data", (chunk) => {
  size += chunk.length;
  if (size > maxSize) {
    child.kill("SIGTERM");
    return;
  }
  chunks.push(chunk);
});
```
- ✅ Bounded memory
- ✅ Can still parse full output if under limit
- ❌ Slightly more complex

### Option 4: Full Streaming (Future)
- Process stdout line-by-line or chunk-by-chunk
- Never buffer entire output
- Required for very large outputs (100MB+)

---

## Recommendation

**Short term**: Switch from string concatenation to Buffer array + `Buffer.concat()`.
**Medium term**: Add 5MB size limit with graceful handling.
**Long term**: Implement streaming parser for structured output markers.

---

## Tests

### Smoke Test: Large stdout
```typescript
it("handles stdout up to 1MB without error", async () => {
  const largeOutput = "x".repeat(1024 * 1024);
  // Mock provider that outputs 1MB
});
```

### Smoke Test: Stderr-heavy execution
```typescript
it("handles verbose stderr without memory issues", async () => {
  const largeStderr = "error\n".repeat(10000);
  // Mock provider with verbose stderr
});
```

**Status**: Not yet implemented. These would require mocking the CLI spawn.
