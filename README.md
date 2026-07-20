# JProgrammer

## Scheduler Engine

The scheduler uses hard constraints first: inactive employees, missing roles, time off, `cannot_work`, time-window restrictions, overlapping shifts, weekend blocks, configured max daily hours, and configured max weekly shift blocks must never be violated automatically. Multiple shifts on the same date are allowed when they do not overlap and stay within daily-hour and weekly-shift limits.

After hard filtering, schedules are compared with a full-schedule evaluator in `src/renderer/services/scheduler/evaluator.ts`. The evaluator produces a reward, grade, score breakdown, metrics, hard violations, soft warnings, and short explanations. Coverage and hard rules dominate the reward, while contract fit, role coverage, experience balance, preferences, weekend balance, and difficult-shift balance refine the result.

Generation uses one production optimization configuration. Managers do not
choose search settings; the app always runs the optimized scheduler. The
configured time budget is a maximum, not a target: the optimizer can stop early
when it finds an excellent schedule or when additional deterministic attempts
stop improving the evaluator reward.

Useful commands:

```bash
npm run test:scheduler
npm run test:solver
npm run benchmark:scheduler
npm run build
```

`test:scheduler` checks evaluator behavior and hard-constraint guarantees with small focused fixtures.

`test:solver` runs the Python CP-SAT solver protocol/model tests when Python is installed. If Python is missing, it reports a skip instead of pretending the solver was tested. For local CP-SAT development, install the runtime with:

```bash
python -m pip install -r solver/requirements.txt
```

The CP-SAT optimizer lives outside the Electron renderer. The main process launches `solver/scheduler_solver.py` through a narrow JSON stdin/stdout protocol, while Python logs go to stderr. TypeScript still owns product semantics: it preprocesses sparse eligible employee-slot pairs using the existing hard-rule checker, then independently validates any CP-SAT output with `validateScheduleHardConstraints` before assignments can be saved. Accepted automatic assignments use the existing atomic `persistValidatedScheduleBatch` path. If Python, OR-Tools, the process, protocol, or final validation fails, the existing heuristic scheduler is used and recorded as `HEURISTIC_FALLBACK`.

The Phase 4 CP-SAT model implements sparse Boolean employee-slot variables, one employee per slot, locked existing assignments, true overlap blocking, owning-date daily-hour limits, weekly shift-block limits, hard requirement-group prior-experience composition, and an exact maximum-coverage objective. Every slot has equal coverage value; there is no priority, critical-role, or role-name weighting in the CP-SAT objective. Status values mean what they say: `OPTIMAL` only when CP-SAT proves optimality, `FEASIBLE` when a valid solution is found without proof, `INFEASIBLE` for true model infeasibility, `MODEL_INVALID` for invalid protocol/model input, and `UNKNOWN` for timeout/runtime failure.

`benchmark:scheduler` runs end-to-end optimized generation scenarios. Each scenario defines opening hours, roles, shift templates, staffing requirements, employees, work rules, availability, and time off; the benchmark then generates slots, runs the real in-memory heuristic assignment optimizer, and evaluates the final schedule. When CP-SAT is available, the benchmark also runs the CP-SAT engine for the same generated slots, validates the result in TypeScript, and compares coverage/status/runtime. If CP-SAT is unavailable, it prints an explicit skip. The benchmark still prints generated slots, assigned/unfilled counts, estimated feasible max coverage, coverage gap, coverage diagnosis, hard violations, warnings, reward, reward per slot, normalized score, grade, manager-facing status, repair iterations, runtime, stop reason, and grouped top notes for the heuristic baseline. The feasible max estimate helps explain whether low coverage is true understaffing or a likely scheduler gap. Manager-facing diagnostics group repeated warnings into high-signal causes and suggested fixes, while detailed warnings remain available internally. Reward per slot and normalized score are benchmark readability metrics for comparing scenarios; absolute evaluator reward remains the internal optimization score. The benchmark also fails on obvious regressions, such as hard violations in normal scenarios, easy cafe not reaching full feasible coverage, excellent easy schedules consuming the full time budget, excellent schedules showing noisy warning-like notes, impossible schedules pretending to be fully covered, uncovered risky scenarios producing no grouped diagnostics, assigned coverage falling meaningfully below the feasible max estimate, or an accepted CP-SAT result failing the TypeScript validator.

The evaluator reward is the final source of truth for full-schedule quality.
Per-slot candidate scoring can still guide construction, but full schedule
selection and repair decisions compare evaluator reward.

GitHub Actions runs `npm ci`, `npm run build`, `npm run test:scheduler`, and
`npm run benchmark:scheduler` on push and pull request.
