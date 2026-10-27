# RC1 Soak Daily Report — Day X

## Date
YYYY-MM-DD

## Environment
- Staging: [URL]
- DB: [connection info]
- Hermes: enabled/disabled
- Gateway: enabled/disabled
- Scheduler: enabled/disabled

## Test Results
| Suite | Status | Tests | Duration |
|-------|--------|-------|----------|
| P0 | PASS/FAIL | N/N | Xms |
| P1 | PASS/FAIL | N/N | Xms |
| P2 | PASS/FAIL | N/N | Xms |
| P3 | PASS/FAIL | N/N | Xms |
| P4 | PASS/FAIL | N/N | Xms |
| P5 | PASS/FAIL | N/N | Xms |
| P6 | PASS/FAIL | N/N | Xms |
| P7 | PASS/FAIL | N/N | Xms |
| P8 | PASS/FAIL | N/N | Xms |
| P9 | PASS/FAIL | N/N | Xms |
| P10 | PASS/FAIL | N/N | Xms |
| P11 | PASS/FAIL | N/N | Xms |
| P12 | PASS/FAIL | N/N | Xms |
| P13 | PASS/FAIL | N/N | Xms |
| RC1 | PASS/FAIL | N/N | Xms |
| Policy-kit | PASS/FAIL | N/N | Xms |

## Security Smoke
- RLS NULL escape: 0
- FORCE RLS: N tables
- Docker socket: absent
- Secret patterns: N

## Hermes Soak
- Invocations: N
- Denials: N
- Prompt injection attempts: N
- Session exhaustions: N
- Write tool attempts: 0

## Gateway Soak
- Invocations: N
- Denials: N
- Redactions: N
- Write tool attempts: 0

## Scheduler Soak
- Jobs run: N
- Completed: N
- Failed: N
- Write attempts: 0

## Incidents
- None / Description

## Blockers
- None / Description

## Decision
- Continue soak / Pause for fix / Abort
