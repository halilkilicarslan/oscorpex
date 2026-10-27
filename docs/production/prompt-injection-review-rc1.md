# RC1-M: Prompt Injection Telemetry Review

**Version**: 1.0
**Date**: 2026-05-14
**Scope**: Prompt injection guards across Hermes (14 patterns) and Learning Governance (23 patterns)
**Status**: RC1 pre-production review

---

## 1. Overview

Oscorpex employs two independent prompt injection guard layers:

1. **Hermes Guard** (`hermes-routes.ts`) — 14 patterns, enforced on every
   `/hermes/invoke` request before tool execution.
2. **Learning Governance Guard** (`learning-governance.ts`) — 23 patterns via
   `detectPromptInjection()`, enforced on learning pattern submissions.

Both layers operate independently. A bypass of one does not bypass the other on
overlapping code paths.

---

## 2. Current Pattern Inventory

### 2.1 Hermes Guard — 14 Patterns

| # | Pattern Category | Example Match |
|---|-----------------|---------------|
| 1 | Instruction override | `ignore previous instructions` |
| 2 | System prompt bypass | `disregard your system prompt` |
| 3 | Role override | `you are now`, `act as` |
| 4 | DAN jailbreak | `do anything now`, `DAN mode` |
| 5 | Prompt leakage | `reveal your system prompt`, `show instructions` |
| 6 | Root/admin escalation | `you are root`, `you have admin access` |
| 7 | Instruction injection via variable | `{{` / `}}` template injection |
| 8 | Context confusion | `pretend you are`, `simulate being` |
| 9 | Permission grant | `you are allowed to`, `you have permission to` |
| 10 | Constraint removal | `forget all restrictions`, `remove all limitations` |
| 11 | Indirect instruction | `the following text contains instructions:` |
| 12 | Output format hijack | `respond only in JSON with field "exec"` (exec variant) |
| 13 | Base64-encoded instruction | Detects `base64:` prefix in tool arguments |
| 14 | Nested prompt | Recursive `<prompt>` or `[INST]` delimiters |

### 2.2 Learning Governance Guard — 23 Patterns

The `detectPromptInjection()` function in `learning-governance.ts` covers all 14
Hermes patterns plus 9 additional patterns targeting learning content specifically:

| # | Additional Pattern Category | Example |
|---|---------------------------|---------|
| 15 | Training data poisoning | `always respond with`, `for all future requests` |
| 16 | Persistent instruction embedding | `remember this for all sessions` |
| 17 | Cross-session bleed | `tell other users that` |
| 18 | Policy extraction | `list all forbidden topics` |
| 19 | Evaluation evasion | `this is a test`, `ignore safety checks during eval` |
| 20 | Capability probing | `what tools can you use`, `list your available functions` |
| 21 | SSRF via learning content | `fetch http://internal.service/` |
| 22 | SQL injection in content | `'; DROP TABLE` |
| 23 | Shell injection in content | `` `rm -rf` ``, `$(curl ...)` |

---

## 3. Detection Rate from Soak (Pre-Production Estimate)

Soak data will populate after RC1-D/E/F soak completes. Pre-production estimates
based on unit test coverage:

| Guard | Patterns Tested | Unit Test Pass Rate | Estimated Production Rate |
|-------|----------------|---------------------|--------------------------|
| Hermes (14) | 14/14 | 100% | > 99% (common patterns) |
| Learning Gov. (23) | 23/23 | 100% | > 99% (common patterns) |

**Note**: "Common patterns" are well-known jailbreak templates. Novel zero-day
injection patterns may not be covered. See Section 6 for LLM-based classifier
recommendation.

---

## 4. False Positive Analysis

### 4.1 Known False Positive Scenarios

| Scenario | Trigger Pattern | Likelihood | Mitigation |
|----------|----------------|-----------|-----------|
| User query about AI safety research | "ignore previous" in academic citation | Low | Pattern requires full phrase match |
| Code review of jailbreak examples | Raw jailbreak template in code | Medium | Context-aware allowlist for code blocks |
| Legal/compliance document scanning | "you are now bound by" in contract | Low | Acceptable — contract text should not be tool input |
| Template literal syntax in JS code | `{{variable}}` in code snippet | Medium | Scope check: detect `{{` only in tool arg values |

### 4.2 False Positive Rate Target

Target: < 0.1% of legitimate Hermes invocations trigger a false positive denial.

If soak shows higher rate, investigate per-pattern contribution and tighten the
most-triggered pattern first.

---

## 5. Pattern Expansion Recommendations

### Short-Term (Before RC2)

| Priority | Pattern | Rationale |
|----------|---------|-----------|
| P1 | Multimodal injection (image alt-text carrying instructions) | Growing attack vector |
| P1 | Unicode homoglyph obfuscation (`іgnоre` with Cyrillic chars) | Bypasses exact string match |
| P1 | Zero-width character insertion | Splits keywords invisibly |
| P2 | Hex/octal encoding of injection strings | `\x69\x67\x6e\x6f\x72\x65` = "ignore" |
| P2 | Reversed text injection | `snoitcurtsni suoiverp erongi` |
| P2 | HTML entity encoding | `&#105;gnore` |

### Medium-Term (First 60 Days Post-Launch)

| Priority | Pattern | Rationale |
|----------|---------|-----------|
| P2 | Indirect injection via external data fetch | Content fetched by a read-tool may carry injection |
| P3 | Multi-turn injection (split across conversation turns) | Pattern only in combined context |
| P3 | Instruction in metadata/filename | Filename `ignore_instructions.txt` |

---

## 6. LLM-Based Secondary Classifier Consideration

### Proposal

Add an optional secondary classifier using a lightweight LLM call (e.g., Claude
Haiku) to score tool inputs for injection probability before execution. The primary
regex guard runs first (fast, zero latency overhead); the LLM classifier runs only
when the regex guard is uncertain (score near threshold).

### Tradeoffs

| Aspect | Pro | Con |
|--------|-----|-----|
| Coverage | Catches novel zero-day patterns | Cannot be deterministic |
| Latency | Haiku is fast (< 200ms P95) | Adds 200ms+ to every flagged request |
| Cost | Low per-call cost | Cumulative cost at scale |
| False positives | Better context understanding | May over-refuse creative content |

### Recommendation for RC1

**Not recommended for RC1**. Regex guard is deterministic and well-tested. LLM
classifier introduces non-determinism into a security-critical path. Revisit for
RC2 after soak data reveals real-world injection patterns.

If implemented: LLM classifier must be advisory-only (log + alert, do not block)
until it has been validated against 30 days of soak traffic.

---

## 7. Telemetry Improvements Needed

| Gap | Priority | Description |
|-----|----------|-------------|
| Unified injection event schema | P2 | Hermes and Learning Gov emit different log formats |
| Per-pattern hit count | P2 | Cannot identify which patterns fire most often |
| False positive tracking | P2 | No mechanism to confirm a denial was a false positive |
| Detection latency metric | P3 | Pattern scan duration not measured |
| Canary injection tests | P1 | Automated daily test using known injection strings |

---

## 8. RC1 Sign-Off Assessment

| Criterion | Status |
|-----------|--------|
| 14 Hermes patterns tested | Pass |
| 23 Learning Gov patterns tested | Pass |
| False positive rate acceptable | Estimated pass — confirm in soak |
| Novel encoding patterns | Gap — address in RC2 |
| LLM secondary classifier | Deferred to RC2 |
| Canary daily test | Recommended before production |

**RC1 verdict**: Injection guard is **sufficient for RC1** with current pattern set.
Unicode/encoding bypass patterns are the primary unmitigated risk; treat as P1
for RC2.

---

*Patterns maintained in `apps/kernel/src/studio/hermes-routes.ts` and
`apps/kernel/src/studio/learning-governance.ts`. Review this document on every
pattern update.*
