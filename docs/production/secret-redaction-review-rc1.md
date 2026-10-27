# RC1-L: Secret Redaction Review

**Version**: 1.0
**Date**: 2026-05-14
**Scope**: `secret-guard.ts` pattern coverage as of P10 expansion (25+ patterns)
**Status**: RC1 pre-production review

---

## 1. Overview

Secret redaction is enforced by `secret-guard.ts` on all outbound responses from
MCP endpoints, Hermes invocations, and Gateway tool results. The guard uses regex
pattern matching to identify and replace secrets with `[REDACTED]` placeholders
before any content leaves the kernel.

As of P10, the pattern set expanded from 13 to 25+ patterns.

---

## 2. Current Pattern Coverage

### 2.1 API Keys and Tokens

| Pattern Category | Regex Prefix/Form | Source |
|-----------------|-------------------|--------|
| OpenAI API key | `sk-[A-Za-z0-9]{20,}` | OpenAI key format |
| Anthropic API key | `sk-ant-[A-Za-z0-9\-_]{20,}` | Anthropic key format |
| GitHub Personal Access Token | `ghp_[A-Za-z0-9]{36}` | GitHub PAT v2 |
| GitHub OAuth token | `gho_[A-Za-z0-9]{36}` | GitHub OAuth |
| GitHub Actions token | `ghs_[A-Za-z0-9]{36}` | GitHub Actions |
| GitHub fine-grained PAT | `github_pat_[A-Za-z0-9_]{82}` | GitHub FGPAT |
| AWS access key ID | `AKIA[0-9A-Z]{16}` | AWS IAM |
| AWS secret access key | `[0-9a-zA-Z/+]{40}` (near AKIA) | AWS IAM |
| Google API key | `AIza[0-9A-Za-z\-_]{35}` | Google services |
| Stripe secret key | `sk_live_[A-Za-z0-9]{24}` | Stripe |
| Stripe test key | `sk_test_[A-Za-z0-9]{24}` | Stripe test |
| Slack bot token | `xoxb-[0-9]{10,}-[A-Za-z0-9]{24,}` | Slack |
| Slack app token | `xapp-[A-Za-z0-9\-_]{80,}` | Slack |

### 2.2 Private Keys and Certificates

| Pattern Category | Form |
|-----------------|------|
| PEM private key | `-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----` |
| RSA private key | `-----BEGIN RSA PRIVATE KEY-----` |
| EC private key | `-----BEGIN EC PRIVATE KEY-----` |
| OpenSSH private key | `-----BEGIN OPENSSH PRIVATE KEY-----` |
| PKCS#8 encrypted key | `-----BEGIN ENCRYPTED PRIVATE KEY-----` |

### 2.3 Database and Connection Strings

| Pattern Category | Form |
|-----------------|------|
| PostgreSQL connection URL | `postgres://[^@]+:[^@]+@` (credentials portion) |
| MySQL connection URL | `mysql://[^@]+:[^@]+@` |
| MongoDB connection URL | `mongodb(\+srv)?://[^@]+:[^@]+@` |
| Redis connection URL | `redis://:[^@]+@` |

### 2.4 Generic Credential Patterns

| Pattern Category | Form |
|-----------------|------|
| `password=<value>` | `password\s*=\s*\S+` (URL param or config) |
| `token=<value>` | `token\s*=\s*\S+` |
| `api_key=<value>` | `api_key\s*=\s*\S+` |
| `secret=<value>` | `secret\s*=\s*\S+` |
| `Authorization: Bearer` header value | `Bearer\s+[A-Za-z0-9\-._~+/]+=*` |
| Basic auth header value | `Basic\s+[A-Za-z0-9+/=]{20,}` |

---

## 3. Known False Positive Categories

False positives occur when benign content matches a secret pattern.

| Category | Example | Impact | Mitigation |
|----------|---------|--------|-----------|
| UUID strings near `sk-` prefix | Task IDs that start with `sk-` (unlikely but possible) | Low | Pattern requires 20+ chars after prefix |
| Base64-encoded non-secrets | Long base64 strings in payloads | Low | Generic base64 pattern not included |
| `password=` in HTML/docs | Password field label in UI code | Low | Acceptable — docs should not contain real passwords |
| `token=` in OAuth redirect URLs | `?token=abc123` in callback URLs (non-secret) | Medium | Consider allowlist for known benign URL patterns |
| AWS-format strings in test data | Mocked AKIA keys in unit test output | Low | Test environment output not in scope |

**Recommended action**: Maintain a false-positive log during soak. If false positive
rate exceeds 1% of redaction events, review patterns for tightening.

---

## 4. Known False Negative Categories

A false negative is a real secret that escapes redaction — the highest-severity
failure mode.

| Category | Risk | Status |
|----------|------|--------|
| Newly introduced token prefixes | A provider creates a new key format (e.g., `claude-sk-`) | Open — requires pattern updates |
| Secrets embedded in JSON values with custom encoding | Base64-encoded secret in a JSON string field | Partial — only decoded output is scanned |
| Secrets split across multiple response chunks (streaming) | Token `sk-` in chunk 1, rest in chunk 2 | Open — streaming not currently redacted |
| Vault dynamic secrets | Short-lived credentials with non-standard prefixes | Open — no dynamic pattern support |
| Secrets in binary/image payloads | Unlikely but theoretically possible | Low risk — binary payloads not text-scanned |

**Highest priority gap**: Streaming response redaction. If Hermes or Gateway ever
returns streaming chunks, each chunk must be individually scanned before emission.
Currently, streaming is not used, but this must be gated if streaming is added.

---

## 5. Canary Secret Audit Mode (Recommended)

For staging and soak testing, implement a canary mode that:

1. Injects known fake secrets (of each pattern category) into test payloads.
2. Verifies each is redacted in the response.
3. Logs any miss as a `redaction_miss` event (alert threshold: any miss = P0).

This catches regressions when patterns are modified.

---

## 6. Periodic Pattern Review Schedule

| Review | Frequency | Trigger |
|--------|-----------|---------|
| Routine pattern audit | Quarterly | Calendar |
| Emergency pattern update | As needed | New provider or service adds new key format |
| Post-incident review | After any P0 redaction miss | Incident post-mortem |
| Soak false-positive analysis | After each soak period | Mid-soak and end-soak |

---

## 7. Pattern Expansion Roadmap

| Priority | Pattern to Add | Justification |
|----------|---------------|---------------|
| P1 | Hugging Face API token (`hf_[A-Za-z0-9]{34}`) | HF integration planned |
| P1 | Azure SAS token (`sig=[A-Za-z0-9%+/=]{43,}`) | Azure storage support |
| P1 | GCP service account key JSON (`"private_key": "-----BEGIN`) | GCP integration |
| P2 | Twilio auth token (`SK[0-9a-fA-F]{32}`) | Twilio notifications |
| P2 | SendGrid API key (`SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}`) | Email integration |
| P2 | npm auth token (`npm_[A-Za-z0-9]{36}`) | Package publishing |
| P3 | Streaming chunk stitching | Safety for future streaming |
| P3 | Per-pattern hit count metrics | Observability improvement |

---

## 8. Security Assessment

Current coverage is **adequate for RC1** given:
- 25+ patterns covering all currently integrated external services
- No streaming output (main false-negative risk vector)
- Soak canary mode planned (closes observability gap)

**RC1 sign-off condition**: P1 pattern expansions (Hugging Face, Azure, GCP) should
be implemented within first 30 days post-launch, tracking actual integrations.

---

*Pattern list should be maintained in `apps/kernel/src/studio/secret-guard.ts`.
Any additions to that file should be mirrored here with a version bump.*
