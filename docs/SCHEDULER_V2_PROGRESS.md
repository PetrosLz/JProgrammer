# Scheduler V2 Progress

This file tracks the staged Scheduler V2 implementation work. It is intentionally explicit so each phase can be resumed safely without guessing.

## Phase 0 - Baseline And Repository Audit

Status: completed baseline audit.

### Commands Executed

- `git status`
  - Result: clean working tree on `main`, up to date with `origin/main`.
- `npm.cmd run build`
  - First sandboxed run failed because `electron-vite`/`esbuild` could not read a parent directory from the sandbox.
  - Re-run outside the sandbox succeeded.
- `npm.cmd run test:scheduler`
  - Result: passed, 10 scheduler regression tests.
- `npm.cmd run benchmark:scheduler`
  - Result: passed, 10 benchmark scenarios.

### Baseline Benchmark Summary

| Scenario | Coverage | Hard violations | Status | Stop reason |
| --- | ---: | ---: | --- | --- |
| easy cafe | 100% | 0 | Excellent | perfect_schedule |
| understaffed cafe | 75% | 0 | Understaffed | time_budget |
| many part-time employees | 100% | 0 | Excellent | perfect_schedule |
| weekend shortage | 83% | 0 | Understaffed | attempt_limit |
| one prior-experience employee | 100% | 0 | Excellent | perfect_schedule |
| impossible schedule | 0% | 0 | Infeasible | attempt_limit |
| multi-role flexible employees | 100% | 0 | Excellent | perfect_schedule |
| high-demand Saturday | 60% | 0 | Understaffed | attempt_limit |
| conflicting availability | 50% | 0 | Understaffed | attempt_limit |
| explicit role scarcity | 56% | 0 | Understaffed | attempt_limit |

### Phase 0 Search Findings

- `break_minutes` remains in:
  - `src/main/migrations/init.sql`
  - `src/main/database.ts`
  - `src/shared/types.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/pages/ShiftTemplatesPage.tsx`
  - `src/renderer/services/demoData.ts`
  - `scripts/scheduler-fixtures.ts`
- One-shift-per-day assumptions remain in:
  - `src/renderer/services/scheduler/constraints.ts`
  - `src/renderer/services/scheduler/assignEmployees.ts`
  - `src/renderer/services/scheduler/coverageCeiling.ts`
  - `src/renderer/services/scheduler/evaluator.ts`
  - `src/renderer/src/pages/ScheduleViewPage.tsx`
  - `src/renderer/src/utils/scheduleDisplay.tsx`
  - `scripts/scheduler-tests.ts`
  - `README.md`
- Deprecated work-rule fields remain in schema, types, scheduler, UI, demo data, fixtures, and reports:
  - `contract_days_per_week`
  - `contract_hours_per_week`
  - `preferred_hours_per_day`
  - `min_days_per_week`
  - `max_days_per_week`
  - `target_days_per_week`
  - `min_hours_per_week`
  - `max_hours_per_week`
  - `target_hours_per_week`
  - `max_consecutive_days`
  - `min_hours_between_shifts`
  - `preferred_hours_per_week`
- `max_hours_per_day` and `target_hours_per_day` do not exist yet.
- `max_shifts_per_week` exists, but is not the active scheduler limit.
- Role-name criticality remains in:
  - `src/renderer/services/scheduler/difficulty.ts`
  - `src/renderer/services/scheduler/evaluator.ts`
- `staffing_requirements.priority` exists, but is typed as `string | null` and the scheduler only recognizes `"high"` in difficulty scoring.
- `employee_time_constraints` exists in the database and shared types, but it is not loaded into the scheduler hard-constraint data path.
- `special_day_staffing_requirements` exists in the database and shared types, but generation does not use it.

### Files Inspected

- `src/shared/types.ts`
- `src/main/database.ts`
- `src/main/migrations/init.sql`
- `src/main/ipc/databaseIpc.ts`
- `src/preload/index.ts`
- `src/renderer/services/databaseApi.ts`
- `src/renderer/services/demoData.ts`
- `src/renderer/services/pdfExportApi.ts`
- `src/renderer/services/scheduler/*`
- `src/renderer/src/pages/*`
- `src/renderer/src/pages/employees/*`
- `src/renderer/src/utils/scheduleDisplay.tsx`
- `scripts/scheduler-tests.ts`
- `scripts/scheduler-benchmark.ts`
- `scripts/scheduler-fixtures.ts`
- `.github/workflows/ci.yml`
- `package.json`
- `README.md`

### Compatibility Risks

- Removing `break_minutes` requires a SQLite table rebuild for `shift_templates`.
- Removing deprecated work-rule columns requires a SQLite table rebuild for `employee_work_rules`.
- Existing employee rows need migration defaults for `max_shifts_per_week`, `max_hours_per_day`, and `target_hours_per_day`.
- Scheduler tests currently assert same-day assignment violations; those tests must be replaced with overlap/split-shift tests.
- Coverage ceiling currently uses a date occupancy bitmask and will understate feasibility when split shifts are allowed.
- Existing manager diagnostics and report filtering parse English warning strings; structured violation codes are needed before large scheduler changes.
- CP-SAT/OR-Tools and PyInstaller are not currently present in the repository.

### Unresolved Risks

- Full CP-SAT integration requires adding Python dependencies and a packaged solver executable. This will require dependency installation and packaging work outside the current TypeScript-only scheduler.
- Existing Greek strings in several files are mojibake; unrelated label cleanup should be separated from scheduler correctness unless it blocks UI validation.
- `special_day_staffing_requirements` needs product/UI decisions for how managers create and edit special-day requirements.

## Phase 1 - Versioned Database Migration Foundation

Status: completed migration-runner foundation.

### Files Changed

- `src/main/migrations/index.ts`
  - Added a versioned migration registry.
  - Reads SQLite `PRAGMA user_version`.
  - Applies only migrations whose version is greater than the current version.
  - Wraps each migration in a transaction.
  - Writes `PRAGMA user_version` and mirrors it to `settings.schema_version` after successful migration.
- `src/main/migrations/v1Compatibility.ts`
  - Moved the existing additive compatibility migration into a named v1 migration.
  - Kept the current compatibility behavior unchanged.
- `src/main/database.ts`
  - Replaced the direct always-run compatibility call with `applyVersionedMigrations`.
- `src/main/migrations/init.sql`
  - Removed the `INSERT ... ON CONFLICT DO UPDATE` that reset `settings.schema_version` to `1` on every app start.

### Migrations Added

- v1 compatibility migration.

### Commands Executed

- `npm.cmd run test:scheduler`
  - Result: passed, 10 scheduler regression tests.
- `npm.cmd run benchmark:scheduler`
  - Result: passed, 10 benchmark scenarios.
- `npm.cmd run build`
  - Result: passed when run outside the sandbox.

### Unresolved Risks

- Phase 1 does not yet add temporary-database migration tests.
- Phase 1 does not yet rebuild tables or remove deprecated columns.
- Existing installations will migrate from `PRAGMA user_version = 0` to `1` and keep the old compatibility behavior. The old `settings.schema_version` value is now informational and no longer drives migration execution.

## Phase 2 - Scheduler V2 Data Model And Compatibility

Status: completed data-model migration and TypeScript/UI compatibility.

### Files Changed

- `src/main/migrations/v2SchedulerModel.ts`
  - Added the V2 scheduler model migration.
  - Rebuilds `employee_work_rules` into the active V2 table:
    - `max_shifts_per_week`
    - `max_hours_per_day`
    - `target_hours_per_day`
    - `can_work_weekends`
    - `notes`
  - Rebuilds `shift_templates` without `break_minutes`.
  - Rebuilds `staffing_requirements` with a constrained priority enum.
  - Creates `scheduler_v2_work_rules_need_review=true` when legacy work-rule rows are migrated.
- `src/main/migrations/index.ts`
  - Bumped `latestSchemaVersion` to `2`.
  - Added per-migration support for table rebuilds with `foreign_keys=OFF`.
  - Enables `legacy_alter_table=ON` during rebuild migrations so foreign-key references continue to point at the rebuilt table names.
  - Runs `PRAGMA foreign_key_check` inside the migration transaction before schema version is written.
- `src/main/migrations/init.sql`
  - Fresh databases now create the V2 schema directly.
  - Removed `shift_templates.break_minutes`.
  - Replaced old employee work-rule columns with V2 work-rule columns.
  - Added `CHECK (priority IN ('normal', 'high', 'critical'))`.
- `src/main/migrations/v1Compatibility.ts`
  - Removed additive work-rule compatibility columns that are intentionally retired by V2.
  - Kept unrelated v1 compatibility additions.
- `src/main/database.ts`
  - Removed deprecated writable columns from `shift_templates` and `employee_work_rules`.
  - Added service-level validation for V2 work-rule writes.
  - Normalizes staffing priority through the shared enum helper.
- `src/shared/types.ts`
  - Removed `ShiftTemplate.break_minutes`.
  - Replaced `EmployeeWorkRules` with the V2 shape.
  - Added `staffingPriorityValues`, `StaffingPriority`, and `normalizeStaffingPriority`.
  - Changed `StaffingRequirement.priority` from `string | null` to `StaffingPriority`.
- Employee UI files under `src/renderer/src/pages/employees/`
  - Employee work rules now edit:
    - maximum shifts per week,
    - maximum hours per day,
    - target hours per working day,
    - weekend permission.
  - New employee defaults are `5` shifts/week, `8` max hours/day, `8` target hours/day, weekends allowed.
  - Employee creation rolls back the new employee row if role/work-rule persistence fails.
- `src/renderer/src/pages/ShiftTemplatesPage.tsx` and `src/renderer/src/App.tsx`
  - Removed `break_minutes` from shift-template creation payloads.
- `src/renderer/services/demoData.ts`
  - Demo work rules now use only V2 fields.
  - Demo shift templates no longer write `break_minutes`.
  - Demo priorities use the constrained enum.
- Scheduler compatibility files under `src/renderer/services/scheduler/`
  - Removed reads of deleted weekly work-rule fields.
  - Added temporary V2 helpers:
    - `getApproximateTargetHoursPerWeek`
    - `getTargetShiftCountPerWeek`
    - `getEffectiveMaxShiftsPerWeek`
  - Existing heuristic still keeps the one-shift-per-day rule until Phase 3.
  - Hard weekly limit now uses `max_shifts_per_week`.
  - Role criticality in difficulty/evaluator now comes from `staffing_requirements.priority === "critical"`, not role names.
- `src/renderer/src/App.tsx`
  - Displays a dismissible review notice when `scheduler_v2_work_rules_need_review=true`.
  - Acknowledgement writes the setting to `false`; it is not dismissed automatically.
- `scripts/migration-tests.ts`
  - Added temporary SQLite migration tests.
- `scripts/tsconfig.scheduler.json` and `package.json`
  - Added `npm.cmd run test:migrations`.
  - Migration tests run under Electron because the local `better-sqlite3` binary is built for Electron's Node ABI.

### Old-To-New Work-Rule Mapping

- `max_shifts_per_week`
  - first valid positive integer from old `max_shifts_per_week`, old `max_days_per_week`, old `contract_days_per_week`, fallback `5`.
- `target_hours_per_day`
  - first valid positive value from old `preferred_hours_per_day`, `contract_hours_per_week / contract_days_per_week`, `target_hours_per_week / target_days_per_week`, fallback `8`.
- `max_hours_per_day`
  - `max(target_hours_per_day, 8, longest active shift-template duration)`.
  - Overnight shifts are calculated as crossing midnight.
  - No break minutes are subtracted.
- `can_work_weekends`
  - old `0` remains `0`; old `1` remains `1`; missing/invalid values become `1`.
- `id`, `employee_id`, `notes`, `created_at`, and `updated_at` are preserved.

### Phase 2 Audit Result

- Active application code no longer references:
  - `break_minutes`
  - `employment_type`
  - `contract_days_per_week`
  - `contract_hours_per_week`
  - `preferred_hours_per_day`
  - `min_days_per_week`
  - `max_days_per_week`
  - `target_days_per_week`
  - `min_hours_per_week`
  - `max_hours_per_week`
  - `target_hours_per_week`
  - `preferred_hours_per_week`
  - `max_consecutive_days`
  - `min_hours_between_shifts`
- Remaining references to those names are intentionally limited to:
  - `src/main/migrations/v2SchedulerModel.ts`, which reads legacy tables,
  - `scripts/migration-tests.ts`, which builds legacy test databases,
  - this historical progress document.
- `priority: string` and `priority: string | null` are no longer present in active staffing types.
- `special_day_staffing_requirements` remains present in schema/shared types/database cleanup, but no manager-facing UI or generation path consumes it yet. It was not expanded in Phase 2 to avoid changing inactive special-day behavior.

### Temporary Compatibility Notes For Phase 3

- Phase 2 historical note: before Phase 3, the heuristic scheduler still blocked same-day assignments.
- `max_hours_per_day` is stored, edited, validated, migrated, and displayed, but full daily-hour accounting is intentionally deferred to Phase 3.
- `max_shifts_per_week` is now the active weekly hard-limit field.
- Approximate weekly target hours in reports/evaluator are derived from `target_hours_per_day * max_shifts_per_week` only when `target_hours_per_day` is set.
- Coverage ceiling still uses a date occupancy bitmask, so split-shift feasibility remains Phase 3 work.

### Migration Tests Added

The migration test script verifies:

- fresh database creates the newest schema,
- existing V1 database migrates to V2,
- employee rows, employee roles, availability, time off, schedules, and assignments are preserved,
- work-rule IDs and employee IDs are preserved,
- `break_minutes` and deprecated work-rule columns are removed,
- new work-rule columns exist,
- valid `max_shifts_per_week` is preserved,
- fallback values are applied safely,
- overnight longest-shift duration is calculated correctly,
- invalid old data is normalized,
- priority is constrained,
- migration review setting is created,
- forced migration failure rolls back schema/data/version,
- running migrations twice is idempotent,
- schema version is not reset by startup init SQL.

### Commands Executed

- `npm.cmd run test:migrations`
  - Result: passed, 5/5 migration tests.
- `npm.cmd run build`
  - First sandboxed run failed because `electron-vite`/`esbuild` could not read a parent directory from the sandbox.
  - Re-run outside the sandbox succeeded.
- `npm.cmd run test:scheduler`
  - Result: passed, 10 scheduler regression tests.
- `npm.cmd run benchmark:scheduler`
  - Result: passed, 10 benchmark scenarios.

### Remaining Phase 3 Work

- Allow multiple shifts per employee on the same date when they do not overlap.
- Replace same-day blocking with overlap and daily-hour accounting.
- Enforce `max_hours_per_day` against total daily scheduled hours.
- Use `max_shifts_per_week` with split-shift counting everywhere.
- Update coverage ceiling away from date-only occupancy.
- Add split-shift scheduler/evaluator/benchmark scenarios.

## Phase 3 - Split Shifts And Hard-Constraint Engine

### Baseline Before Phase 3 Changes

- `git status` showed an already-dirty worktree from the Phase 2 implementation.
- `npm.cmd run build`
  - TypeScript passed.
  - Sandboxed `electron-vite` failed with an esbuild parent-directory access error; the same command needs escalation in this Codex environment.
- `npm.cmd run test:scheduler`
  - Passed, 10 scheduler regression tests.
- `npm.cmd run benchmark:scheduler`
  - Passed, 10 benchmark scenarios.
- `npm.cmd run test:migrations`
  - Passed, 5 migration tests.

### Phase 3 Changes Implemented

- Added `src/renderer/services/scheduler/model/workingTime.ts`.
  - Central deterministic duration, overlap, overnight split, date arithmetic, day-of-week, and week-key logic.
  - Adjacent shifts are not overlaps.
  - Overnight shifts split minutes across every touched business date.
- Refactored `src/renderer/services/scheduler/constraints.ts`.
  - Hard constraints now return structured violation codes plus legacy `reasons` for compatibility.
  - Removed active same-date rejection from the hard-rule engine.
  - Added daily-hour validation using `max_hours_per_day`.
  - Added weekly shift-block validation using `max_shifts_per_week`.
  - Added employee time-window `cannot_work` enforcement.
  - Weekend restrictions inspect every date touched by a shift.
- Added `src/renderer/services/scheduler/model/assignmentState.ts`.
  - Tracks slot IDs, absolute intervals, daily assigned minutes, weekly shift counts, total minutes, and assigned shifts together.
- Added `src/renderer/services/scheduler/evaluation/scheduleValidator.ts`.
  - Validates full schedules for missing references, duplicate slot assignments, duplicate employee-slot pairs, and hard-rule violations.
- Refactored coverage ceiling away from date-only occupancy state.
  - Ceiling state now distinguishes intervals and daily minute totals, so split shifts can increase exact feasible coverage.
- Added `employee_time_constraints` loading to the renderer summary and passed it through generation, manual assignment validation, evaluation, and benchmarks.
- Updated evaluator/scoring fairness inputs to use shift blocks/minutes instead of unique assigned days for weekly work-rule comparison.
- Updated scheduler tests with focused coverage for:
  - working-time duration/overlap/week keys,
  - valid split shifts,
  - adjacent shifts,
  - overlap rejection,
  - daily-hour limits,
  - weekly shift-block limits,
  - overnight overlap,
  - time-window `cannot_work`.
- Updated benchmark scenarios and output.
  - Added `split shifts required`.
  - Added `time-window restriction`.
  - Output now includes overlap, daily-hour, weekly-shift violation counts and exact/approximate coverage ceiling label.

### Phase 3 Validation Results

- `npm.cmd run test:scheduler`
  - Passed, 17 scheduler regression tests.
- `npm.cmd run benchmark:scheduler`
  - Passed, 12 benchmark scenarios.
  - `split shifts required`: 2/2 assigned, 100% coverage, 0 hard violations, exact ceiling.
  - `time-window restriction`: 1/2 assigned, 0 hard violations, exact ceiling, manager status `Infeasible`.

### Remaining Phase 3/CP-SAT Preparation Risks

- The heuristic scheduler still uses its existing repair/move/swap architecture. Hard-rule checks now support split shifts, but a future CP-SAT phase should replace heuristic repair with a proper optimizer.
- Large benchmark scenarios can still consume the current 15s optimizer budget; coverage ceiling correctly labels approximate results.
- Some existing manager-facing strings remain mojibake from previous UI encoding work and should be cleaned separately from scheduler semantics.

## Phase 4 - CP-SAT Optimizer Foundation

### Architecture

- Added a Python OR-Tools solver boundary under `solver/`.
  - `scheduler_solver.py` reads exactly one JSON request from stdin and writes one JSON result to stdout.
  - Python logs and failures go to stderr/message fields so protocol output remains parseable.
  - `requirements.txt` documents the runtime dependency: `python -m pip install -r solver/requirements.txt`.
- Added main-process solver integration under `src/main/solver/`.
  - Runtime discovery checks Python plus OR-Tools without installing anything.
  - Solver execution has timeout handling, stderr/stdout capture, non-zero exit handling, and invalid JSON handling.
- Added solver IPC through `src/main/ipc/solverIpc.ts` and the preload bridge.
  - The renderer receives only typed availability/solve operations.
  - No arbitrary shell command is exposed to renderer code.

### Protocol

- Shared solver types live in `src/shared/solverTypes.ts`.
- The request includes:
  - request id,
  - schedule/run metadata,
  - employees with active flag, max weekly shift blocks, max daily minutes, and weekend eligibility,
  - role-specific experience,
  - schedule slots with requirement-group snapshots and absolute intervals,
  - sparse eligible employee-slot pairs,
  - locked existing assignments,
  - timeout seconds.
- The result includes assignments, `OPTIMAL`/`FEASIBLE`/`INFEASIBLE`/`MODEL_INVALID`/`UNKNOWN` status, covered/total slots, coverage rate, runtime, and message.

### Implemented CP-SAT Model

- Boolean variable only for each eligible employee-slot pair.
- Hard constraints:
  - at most one employee per slot,
  - locked existing assignments fixed,
  - true interval overlap blocked while adjacent split shifts remain allowed,
  - all overnight minutes belong to the owning/start date for daily-hour limits,
  - max weekly shift blocks,
  - requirement-group prior-experience composition with `min(experiencedRequiredCount, assignedCount)`.
- Primary objective:
  - maximize exact total covered slots.
  - all slots have equal value.
  - no staffing priority, critical-role, or role-name weighting was restored.

### TypeScript Validation And Persistence

- `src/renderer/services/scheduler/cpSatAdapter.ts` preprocesses solver input using the existing TypeScript hard-rule checker.
- Accepted CP-SAT results are converted to planned assignments, combined with locked existing assignments, and passed through `validateScheduleHardConstraints`.
- Invalid solver output is rejected before persistence.
- Accepted automatic assignments still use the existing atomic `persistValidatedScheduleBatch` operation.
- The existing heuristic remains the explicit fallback and is recorded as `HEURISTIC_FALLBACK` when CP-SAT is unavailable, fails, times out, returns a non-accepted status, or fails validation.

### Tests And Benchmarks

- Added `npm.cmd run test:solver`.
  - It runs Python unittest solver tests when Python is installed.
  - It reports a clear skip when Python is not present.
- Added focused Python protocol/model tests for malformed JSON, full coverage, overlap blocking, adjacent split shifts, group experience, and zero-worker zero coverage.
- Added a TypeScript scheduler regression test proving accepted CP-SAT output uses atomic batch persistence once and records `cp_sat`.
- Extended `benchmark:scheduler` to compare CP-SAT when available.
  - If unavailable, the benchmark prints a CP-SAT skip and still runs the full heuristic benchmark.
  - Accepted CP-SAT benchmark results must pass the TypeScript validator.
  - `OPTIMAL` CP-SAT coverage must not be lower than heuristic coverage for the same hard model.

### Known Limitations Before Phase 4.2

- CP-SAT Phase 4 optimizes maximum coverage only.
- It does not yet implement lexicographic soft objectives for fairness, preferences, role scarcity, rotation, or manager-friendly team quality beyond hard group experience.
- Heuristic warm-start hints are not wired yet; the integration point exists, but hints are not faked.
- Windows packaging of a Python/OR-Tools runtime remains a later phase.
- Next phase: add lexicographic CP-SAT objectives after maximum coverage, then compare soft-quality reward against the heuristic without weakening hard constraints.

## Phase 4.2 - CP-SAT Production Optimization

### Production Execution Order

- Automatic generation now attempts CP-SAT before the expensive full heuristic.
- The full heuristic optimizer remains present but runs only as a labelled `HEURISTIC_FALLBACK` when CP-SAT is unavailable, crashes, times out without usable output, returns an unusable status, produces malformed data, or fails independent TypeScript validation.
- Accepted CP-SAT and fallback heuristic schedules both flow through:
  - in-memory solve,
  - `validateScheduleHardConstraints`,
  - complete batch request construction,
  - one atomic `persistValidatedScheduleBatch` transaction.

### Lexicographic Objective Stages

- Stage 1: maximize exact requested-slot coverage. All slots have equal value.
- Stage 2: minimize target daily-hour deviation by owning/start date.
  - For employees with `target_hours_per_day`, deviation is `abs(worked_minutes - target_minutes * worked_day)`.
  - Non-working employee-days contribute zero deviation.
  - Employees without `target_hours_per_day` are ignored by this objective.
- Stage 3: minimize weekly shift-count range among active employees with at least one eligible assignment variable.
- Stage 4: minimize weekly minute range for the same fairness-eligible employees.
- Stage 5: maximize explicit preference score only from existing data:
  - preferred role,
  - day-level `prefers_to_work`,
  - shift-level `prefers_to_work`.
- Stage 6: maximize agreement with valid hints when hints are supplied.
- A lower-priority stage runs only after the previous stage is `OPTIMAL`; each proven optimum is frozen before continuing.

### Proof And Status Semantics

- `OPTIMAL` means every requested/reached objective stage was proven optimal.
- `FEASIBLE` means a valid solution exists but full lexicographic proof stopped early.
- Coverage proof is reported independently as `coverageProvenOptimal`.
- Full staged proof is reported as `fullLexicographicOptimality`.
- Ordinary understaffing remains a valid optimal result when no more eligible employee-slot assignments exist.

### Hints

- Production creates bounded greedy warm-start hints from the already hard-filtered sparse eligibility pairs.
- This hint pass does not run the full heuristic optimizer before CP-SAT.
- Hints are accepted only for existing sparse eligible variables and ignored otherwise.
- Hints never become hard constraints.

### Runtime Discovery

- Runtime discovery checks:
  - `JPROGRAMMER_PYTHON`,
  - `JPROGRAMMER_TEST_PYTHON` only for explicit test harness use,
  - `.venv-solver/Scripts/python.exe`,
  - `.venv-solver/bin/python`,
  - `py -3.12`,
  - `py -3.11`,
  - `python`,
  - `python3`.
- Availability verifies both `ortools` and `ortools.sat.python.cp_model`.
- The solver reports Python and OR-Tools versions in telemetry.
- `.venv-solver` remains ignored by Git.

### Tests And Benchmarks

- Python solver tests now execute real OR-Tools in this workspace using the available local/bundled Python runtime plus `.venv-solver` packages.
- Scheduler regression tests include a mocked CP-SAT acceptance path that verifies:
  - CP-SAT output uses one atomic batch,
  - `cp_sat` is recorded,
  - the heuristic selected profile remains `null`, proving the full heuristic was not constructed first.
- Benchmark output now includes CP-SAT status, coverage proof, full lexicographic proof, stage values, validation status, and runtime alongside the heuristic comparison baseline.

### Remaining Limitations

- Production hint generation is intentionally omitted until a genuinely bounded fast heuristic mode exists.
- CP-SAT does not yet optimize role scarcity/rotation beyond explicit preference and fairness stages.
- Windows installer packaging still does not bundle Python/OR-Tools.
