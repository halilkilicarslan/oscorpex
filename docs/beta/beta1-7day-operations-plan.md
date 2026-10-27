# Internal Beta-1 — 7-Day Operations Plan

## Day 1 (2026-05-18): Launch & Verify
- [x] Start kernel + console + DB
- [x] Verify WeatherAPI project (17/17 tasks, 13/13 tests)
- [x] Security smoke (write disabled, no secrets, tenant isolation)
- [x] Fix discovered bugs (11 total)
- [x] Day 1 report: GO

## Day 2-3: Stability Monitoring
- [ ] Create 2nd project (different type — e.g. CLI tool or library)
- [ ] Monitor token usage trends
- [ ] Monitor error rate
- [ ] Check audit log growth
- [ ] Verify no write tool bypass
- [ ] Daily report

## Day 4-5: Stress & Edge Cases
- [ ] Create project with larger scope (15+ tasks)
- [ ] Test approval flow end-to-end
- [ ] Test rollback preview
- [ ] Verify Hermes read-only with multiple tool calls
- [ ] Check session budget exhaustion behavior
- [ ] Daily report

## Day 6-7: Assessment & Final Report
- [ ] Review all daily reports
- [ ] Calculate total cost/token across all projects
- [ ] Review error patterns
- [ ] Review agent performance
- [ ] Prepare 7-day final report
- [ ] GO/NO-GO for expansion

## Daily Checklist (Every Day)
1. Check kernel health: `curl localhost:3141/health`
2. Check console: `open localhost:5161/studio`
3. Check Hermes dashboard: `open localhost:5161/studio/hermes`
4. Review audit log: `open localhost:5161/studio/mcp/audit`
5. Check for write tool attempts: Should be 0
6. Check for secret leaks: Should be 0
7. Check for cross-tenant access: Should be 0

## Budget Thresholds
| Metric | Warning | Critical |
|--------|---------|----------|
| Cost per project | > $2.00 | > $5.00 |
| Tokens per project | > 500K | > 1M |
| Error rate | > 10% | > 25% |
| Pipeline failure | Any | 2+ consecutive |

## Escalation
- P0 (security breach): Immediate ROLLBACK
- P1 (service outage): PAUSE + investigate
- P2 (elevated errors): WATCH + daily review
- P3 (minor UX issue): Log + continue
