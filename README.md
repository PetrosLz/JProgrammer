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
npm run test:migrations
npm run test:time-model
npm run test:randomized
npm run audit:scheduler
npm run benchmark:scheduler
npm run benchmark:scheduler:stress
npm run build
```

`test:scheduler` checks evaluator behavior and hard-constraint guarantees with small focused fixtures.

`test:time-model` checks the Scheduler V2 time model: automatic next-day shifts, invalid equal start/end shifts, non-overlapping split shifts on the same date, real overnight overlaps, owning-date daily hours, continuous opening-hours containment, special-day opening fallback/override behavior, and explicit 24-hour opening mode.

`test:randomized` runs 150 deterministic randomized CP-SAT scenarios (100 small and 50 medium) with real generated slots, sparse eligibility, final TypeScript validation, locked-assignment cases, availability, time off, 24-hour openings, and daily/weekly limits.

`audit:scheduler` scans active scheduler/schema/UI surfaces for deprecated work-rule fields, `break_minutes`, manual overnight controls, staffing priority in the fresh schema, role-name-based criticality, and Demo Cafe business-data drift beyond 24-hour schema compatibility.

`test:migrations` checks fresh and legacy schema upgrades, including the v3-to-v4 migration that adds explicit opening-hours 24-hour mode, normalizes stored overnight flags without inferring 24-hour operation from equal opening times, and deactivates legacy equal-time shift templates for manager review.

`test:solver` runs the Python CP-SAT solver protocol/model tests and fails clearly when no Python runtime with OR-Tools is available. For local CP-SAT development, install the runtime with:

```bash
python -m pip install -r solver/requirements.txt
```

The CP-SAT optimizer lives outside the Electron renderer. The main process launches `solver/scheduler_solver.py` through a narrow JSON stdin/stdout protocol, while Python logs go to stderr. TypeScript still owns product semantics: it preprocesses sparse eligible employee-slot pairs using the existing hard-rule checker, then independently validates any CP-SAT output with `validateScheduleHardConstraints` before assignments can be saved. Production generation is CP-SAT-first: the full heuristic optimizer runs only as a labelled `HEURISTIC_FALLBACK` when Python, OR-Tools, the process, protocol, solver status, or final validation is unusable. Accepted automatic assignments use the existing atomic `persistValidatedScheduleBatch` path.

Runtime discovery checks `JPROGRAMMER_PYTHON`, project-local `.venv-solver`, `py -3.12`, `py -3.11`, `python`, and `python3`. Test harnesses may opt into `JPROGRAMMER_TEST_PYTHON`, but production discovery does not include Codex-specific runtime paths. The local `.venv-solver` folder remains ignored by Git. Packaging a Python/OR-Tools runtime into the Windows installer is still a later task.

Opening hours are modeled as continuous absolute local business intervals. A 24-hour day runs from local `00:00` of that business date to local `00:00` of the next date; it does not automatically cover the next morning if the next day is closed or opens later. Cross-midnight custom openings may carry into the following date, closed days prevent new intervals from starting, and adjacent intervals merge only when there is no gap. Slot generation validates the whole shift interval against those merged openings, not just the shift start time.

Scheduler V2 stores the business timezone, but duration and daily-limit math intentionally use the manager-entered wall-clock schedule minutes. DST clock changes do not alter scheduled shift duration, and the model does not yet represent repeated/nonexistent local-time disambiguation or real elapsed UTC duration.

The Phase 4.2 CP-SAT model implements sparse Boolean employee-slot variables, one employee per slot, locked existing assignments, true overlap blocking, owning-date daily-hour limits, weekly shift-block limits, and hard requirement-group prior-experience composition. It solves staged lexicographic objectives with one shared deadline:

1. maximize exact coverage,
2. minimize target daily-hour deviation by owning date,
3. minimize weekly shift-count range among employees with eligible variables,
4. minimize weekly minute range for that same fairness population,
5. maximize explicit preference score from preferred role, preferred day, and preferred shift availability,
6. maximize agreement with valid hints when hints exist.

Production warm-start hints are generated by a bounded greedy pass over the already hard-filtered sparse eligibility pairs. This does not run the full heuristic optimizer before CP-SAT; it only proposes safe employee-slot hints within a tiny time budget.

A lower stage runs only after the previous stage is proven optimal and then frozen. Every requested slot has equal coverage value; there is no priority, critical-role, or role-name weighting in the CP-SAT objective. Status values mean what they say: `OPTIMAL` only when every reached/requested stage proves optimal, `FEASIBLE` when a valid schedule exists but lower-stage proof stops at the deadline, `INFEASIBLE` for true model infeasibility, `MODEL_INVALID` for invalid protocol/model input, and `UNKNOWN` for timeout/runtime failure. The solver reports coverage proof separately from full lexicographic proof.

`benchmark:scheduler` runs end-to-end optimized generation scenarios. Each scenario defines opening hours, roles, shift templates, staffing requirements, employees, work rules, availability, and time off; the benchmark then generates slots, runs the real in-memory heuristic assignment optimizer, and evaluates the final schedule. When CP-SAT is available, the benchmark also runs the CP-SAT engine for the same generated slots, validates the result in TypeScript, and compares coverage/status/runtime. If CP-SAT is unavailable, it prints an explicit skip. The command also runs a 20-scenario differential CP-SAT-vs-heuristic matrix covering 24-hour, overnight, sparse eligibility, locked assignment, no-worker, no-slot, weekend, time-off, split-shift, and daily-limit cases. The benchmark still prints generated slots, assigned/unfilled counts, estimated feasible max coverage, coverage gap, coverage diagnosis, hard violations, warnings, reward, reward per slot, normalized score, grade, manager-facing status, repair iterations, runtime, stop reason, and grouped top notes for the heuristic baseline. The feasible max estimate helps explain whether low coverage is true understaffing or a likely scheduler gap. Manager-facing diagnostics group repeated warnings into high-signal causes and suggested fixes, while detailed warnings remain available internally. Reward per slot and normalized score are benchmark readability metrics for comparing scenarios; absolute evaluator reward remains the internal optimization score. The benchmark also fails on obvious regressions, such as hard violations in normal scenarios, easy cafe not reaching full feasible coverage, excellent easy schedules consuming the full time budget, excellent schedules showing noisy warning-like notes, impossible schedules pretending to be fully covered, uncovered risky scenarios producing no grouped diagnostics, assigned coverage falling meaningfully below the feasible max estimate, or an accepted CP-SAT result failing the TypeScript validator.

`benchmark:scheduler:stress` runs bounded CP-SAT stress tiers (small, medium, and large by default, with an opt-in very-large tier) and reports preprocessing, warm-start hint generation, solver, validation, total runtime, status, coverage, proof flags, and a classification such as `solved_optimal`, `solved_feasible`, or `bounded_unknown`. UNKNOWN large-tier results are reported explicitly as degraded performance instead of being converted into invented objective values or called passed.

The evaluator reward is the final source of truth for full-schedule quality.
Per-slot candidate scoring can still guide construction, but full schedule
selection and repair decisions compare evaluator reward.

GitHub Actions uses Node 22 and Python 3.12, installs `solver/requirements.txt`, runs `npm ci`, and then runs build, solver tests, scheduler tests, migration tests, time-model tests, randomized tests, scheduler audit, the scheduler benchmark, and small/medium stress tiers on push and pull request. A manual workflow dispatch option can run the full stress benchmark.

Packaging note: the current Windows electron-builder configuration packages the Electron output and `package.json`; it does not bundle `solver/scheduler_solver.py`, Python, or OR-Tools. The installed app is therefore not yet a fully self-contained CP-SAT distribution. A future packaging task should add an explicit Windows solver runtime bundle or installer prerequisite flow.
