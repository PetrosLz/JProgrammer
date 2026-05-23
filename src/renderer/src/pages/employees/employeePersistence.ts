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
  const contractDays = parseOptionalNumber(form.contractDaysPerWeek) ?? 5;
  const contractHours = parseOptionalNumber(form.contractHoursPerWeek) ?? 40;
  const preferredHoursPerDay =
    parseOptionalNumber(form.preferredHoursPerDay) ??
    (contractDays > 0 ? contractHours / contractDays : 8);
  const maxConsecutiveDays = parseOptionalNumber(form.maxConsecutiveDays) ?? 5;
  const derivedMaxDays = Math.min(7, contractDays + 1);
  const derivedMaxHours = contractHours + 4;
  const payload = {
    employee_id: employeeId,
    employment_type: form.employmentType,
    contract_days_per_week: contractDays,
    contract_hours_per_week: contractHours,
    preferred_hours_per_day: preferredHoursPerDay,
    min_days_per_week: null,
    max_days_per_week: derivedMaxDays,
    target_days_per_week: contractDays,
    min_hours_per_week: null,
    max_hours_per_week: derivedMaxHours,
    target_hours_per_week: contractHours,
    max_consecutive_days: maxConsecutiveDays,
    can_work_weekends: form.canWorkWeekends,
    max_shifts_per_week: derivedMaxDays,
    min_hours_between_shifts: null,
    preferred_hours_per_week: contractHours,
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
