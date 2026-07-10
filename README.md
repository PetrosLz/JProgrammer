# JProgrammer

## Scheduler Engine

The scheduler uses hard constraints first: inactive employees, missing roles, time off, `cannot_work`, same-day assignments, overlapping shifts, weekend blocks, and configured max hours/days must never be violated automatically.

After hard filtering, schedules are compared with a full-schedule evaluator in `src/renderer/services/scheduler/evaluator.ts`. The evaluator produces a reward, grade, score breakdown, metrics, hard violations, soft warnings, and short explanations. Coverage and hard rules dominate the reward, while contract fit, role coverage, experience balance, preferences, weekend balance, and difficult-shift balance refine the result.

Generation uses one production optimization configuration. Managers do not
choose search settings; the app always runs the optimized scheduler. The
configured time budget is a maximum, not a target: the optimizer can stop early
when it finds an excellent schedule or when additional deterministic attempts
stop improving the evaluator reward.

Useful commands:

```bash
npm run test:scheduler
npm run benchmark:scheduler
npm run build
```

`test:scheduler` checks evaluator behavior and hard-constraint guarantees with small focused fixtures.

`benchmark:scheduler` runs end-to-end optimized generation scenarios. Each scenario defines opening hours, roles, shift templates, staffing requirements, employees, work rules, availability, and time off; the benchmark then generates slots, runs the real in-memory assignment optimizer, and evaluates the final schedule. It prints generated slots, assigned/unfilled counts, estimated feasible max coverage, coverage gap, coverage diagnosis, hard violations, warnings, reward, reward per slot, normalized score, grade, manager-facing status, repair iterations, runtime, stop reason, and grouped top notes. The feasible max estimate helps explain whether low coverage is true understaffing/infeasibility or a likely scheduler gap. Manager-facing diagnostics group repeated warnings into high-signal causes and suggested fixes, while detailed warnings remain available internally. Reward per slot and normalized score are benchmark readability metrics for comparing scenarios; absolute evaluator reward remains the internal optimization score. The benchmark also fails on obvious regressions, such as hard violations in normal scenarios, easy cafe not reaching full feasible coverage, excellent easy schedules consuming the full time budget, excellent schedules showing noisy warning-like notes, impossible schedules pretending to be fully covered, uncovered risky scenarios producing no grouped diagnostics, or assigned coverage falling meaningfully below the feasible max estimate.

The evaluator reward is the final source of truth for full-schedule quality.
Per-slot candidate scoring can still guide construction, but full schedule
selection and repair decisions compare evaluator reward.

GitHub Actions runs `npm ci`, `npm run build`, `npm run test:scheduler`, and
`npm run benchmark:scheduler` on push and pull request.
