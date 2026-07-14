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

- The heuristic scheduler still blocks same-day assignments via `hasAssignmentOnDate`.
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
