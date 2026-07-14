import { databaseApi } from "../../../services/databaseApi";
import { experienceLevelToLegacySkillLevel, normalizeExperienceLevel } from "../../../types";
import type { EmployeeRole, EmployeeWorkRules } from "../../../types";
import type { EmployeeForm, EmployeeWorkRulesForm } from "./employeeTypes";
import { parseOptionalNumber } from "./employeeForms";

export async function syncEmployeeRoleAssignments(
  employeeId: string,
  form: EmployeeForm,
  allEmployeeRoles: EmployeeRole[]
): Promise<void> {
  const existingAssignments = allEmployeeRoles.filter(
    (employeeRole) => employeeRole.employee_id === employeeId
  );
  const selectedRoleIds = form.roleIds;
  const selectedRoleIdSet = new Set(selectedRoleIds);

  for (const assignment of existingAssignments) {
    if (!selectedRoleIdSet.has(assignment.role_id)) {
      await databaseApi.deleteRecord("employee_roles", assignment.id);
    }
  }

  for (const [index, roleId] of selectedRoleIds.entries()) {
    const existingAssignment = existingAssignments.find(
      (assignment) => assignment.role_id === roleId
    );
    const isPrimary = index === 0;
    const details = form.roleDetails[roleId] ?? {
      experienceLevel: "some_experience",
      canLeadRole: false,
      isPreferredRole: false
    };
    const experienceLevel = normalizeExperienceLevel(details.experienceLevel);
    const payload = {
      employee_id: employeeId,
      role_id: roleId,
      is_primary: isPrimary,
      experience_level: experienceLevel,
      skill_level: experienceLevelToLegacySkillLevel(experienceLevel),
      can_lead_role: details.canLeadRole,
      is_preferred_role: details.isPreferredRole
    };

    if (existingAssignment) {
      await databaseApi.updateRecord(
        "employee_roles",
        existingAssignment.id,
        payload
      );
      continue;
    }

    await databaseApi.createRecord("employee_roles", payload);
  }
}

export async function upsertEmployeeWorkRules(
  employeeId: string,
  form: EmployeeWorkRulesForm,
  allWorkRules: EmployeeWorkRules[]
): Promise<void> {
  const existingWorkRules = allWorkRules.find(
    (workRules) => workRules.employee_id === employeeId
  );
  const maxShiftsPerWeek = parseOptionalNumber(form.maxShiftsPerWeek) ?? 5;
  const maxHoursPerDay = parseOptionalNumber(form.maxHoursPerDay) ?? 8;
  const targetHoursPerDay = parseOptionalNumber(form.targetHoursPerDay);
  const payload = {
    employee_id: employeeId,
    max_shifts_per_week: maxShiftsPerWeek,
    max_hours_per_day: maxHoursPerDay,
    target_hours_per_day: targetHoursPerDay,
    can_work_weekends: form.canWorkWeekends,
    notes: null
  };

  if (existingWorkRules) {
    await databaseApi.updateRecord(
      "employee_work_rules",
      existingWorkRules.id,
      payload
    );
    return;
  }

  await databaseApi.createRecord("employee_work_rules", payload);
}
