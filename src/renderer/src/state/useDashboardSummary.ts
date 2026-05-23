import { useCallback, useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import { emptySummary, type DashboardSummary } from "../types/dashboard";
import { setupCompletedKey } from "./setupConstants";

export function useDashboardSummary() {
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);

  const refreshSummary = useCallback(async () => {
    const [
      businessSettings,
      openingHours,
      roles,
      shiftTemplates,
      specialDays,
      staffingRequirements,
      scheduleRuns,
      scheduleSlots,
      scheduleAssignments,
      scheduleWarnings,
      employees,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      timeOff,
      setupCompletedAt
    ] = await Promise.all([
      databaseApi.listRecords("business_settings", { limit: 1 }),
      databaseApi.listRecords("opening_hours", { limit: 20 }),
      databaseApi.listRecords("roles", { limit: 200 }),
      databaseApi.listRecords("shift_templates", { limit: 200 }),
      databaseApi.listRecords("special_days", { limit: 500 }),
      databaseApi.listRecords("staffing_requirements", { limit: 500 }),
      databaseApi.listRecords("schedule_runs", { limit: 100 }),
      databaseApi.listRecords("schedule_slots", { limit: 5000 }),
      databaseApi.listRecords("schedule_assignments", { limit: 5000 }),
      databaseApi.listRecords("schedule_warnings", { limit: 1000 }),
      databaseApi.listRecords("employees", { limit: 500 }),
      databaseApi.listRecords("employee_roles", { limit: 1000 }),
      databaseApi.listRecords("employee_work_rules", { limit: 500 }),
      databaseApi.listRecords("employee_day_constraints", { limit: 4000 }),
      databaseApi.listRecords("employee_shift_availability", { limit: 4000 }),
      databaseApi.listRecords("time_off", { limit: 1000 }),
      databaseApi.getSetting(setupCompletedKey)
    ]);

    setSummary({
      businessSettings: businessSettings[0] ?? null,
      openingHours,
      roles,
      shiftTemplates,
      specialDays,
      staffingRequirements,
      scheduleRuns,
      scheduleSlots,
      scheduleAssignments,
      scheduleWarnings,
      employees,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      timeOff,
      setupCompletedAt: setupCompletedAt?.value ?? null
    });
  }, []);

  const resetSummary = useCallback(() => {
    setSummary(emptySummary);
  }, []);

  return {
    summary,
    refreshSummary,
    resetSummary
  };
}
