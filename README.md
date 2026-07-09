# JProgrammer

## Scheduler Engine

The scheduler uses hard constraints first: inactive employees, missing roles, time off, `cannot_work`, same-day assignments, overlapping shifts, weekend blocks, and configured max hours/days must never be violated automatically.

After hard filtering, schedules are compared with a full-schedule evaluator in `src/renderer/services/scheduler/evaluator.ts`. The evaluator produces a reward, grade, score breakdown, metrics, hard violations, soft warnings, and short explanations. Coverage and hard rules dominate the reward, while contract fit, role coverage, experience balance, preferences, weekend balance, and difficult-shift balance refine the result.

Generation supports three quality modes:

- `fast`: quick draft, 20 attempts, 80 repair iterations, 1500 ms budget.
- `balanced`: default, 80 attempts, 200 repair iterations, 5000 ms budget.
- `best`: deeper search, 300 attempts, 600 repair iterations, 15000 ms budget.

Useful commands:

```bash
npm run test:scheduler
npm run benchmark:scheduler
npm run build
```

`test:scheduler` checks evaluator behavior and hard-constraint guarantees with small focused fixtures.

`benchmark:scheduler` runs end-to-end generation scenarios. Each scenario defines opening hours, roles, shift templates, staffing requirements, employees, work rules, availability, and time off; the benchmark then generates slots, runs the real in-memory assignment optimizer, evaluates the final schedule, and compares `fast`, `balanced`, and `best` quality modes. It prints generated slots, assigned/unfilled counts, coverage, hard violations, warnings, reward, grade, repair iterations, runtime, and top notes. The benchmark also fails on obvious regressions, such as hard violations in normal scenarios, easy cafe not reaching full coverage, impossible schedules pretending to be fully covered, or `best` regressing below `fast` by both reward and coverage.
