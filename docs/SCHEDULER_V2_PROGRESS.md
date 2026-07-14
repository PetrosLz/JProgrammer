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
