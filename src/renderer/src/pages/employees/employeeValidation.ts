import type { Employee } from "../../../types";
import type { UiLanguage } from "../../utils/localization";
import { parseOptionalNumber } from "./employeeForms";
import { timeOffTypeOptions } from "./employeeFormatters";
import type { EmployeeForm, TimeOffForm } from "./employeeTypes";

export function validateEmployeeFormForLanguage(
  form: EmployeeForm,
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.firstName.trim()) {
    errors.push(
      language === "en" ? "First name is required." : "Το όνομα είναι υποχρεωτικό."
    );
  }

  if (!form.lastName.trim()) {
    errors.push(
      language === "en" ? "Last name is required." : "Το επώνυμο είναι υποχρεωτικό."
    );
  }

  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push(
      language === "en" ? "Enter a valid email." : "Συμπληρώστε έγκυρο email."
    );
  }

  const maxShiftsPerWeek = parseOptionalNumber(
    form.workRules.maxShiftsPerWeek
  );
  const maxHoursPerDay = parseOptionalNumber(form.workRules.maxHoursPerDay);
  const targetHoursPerDay = parseOptionalNumber(
    form.workRules.targetHoursPerDay
  );

  if (
    maxShiftsPerWeek === null ||
    !Number.isInteger(maxShiftsPerWeek) ||
    maxShiftsPerWeek < 1
  ) {
    errors.push(
      language === "en"
        ? "Maximum shifts per week must be an integer greater than or equal to 1."
        : "Οι μέγιστες βάρδιες ανά εβδομάδα πρέπει να είναι ακέραιος αριθμός από 1 και πάνω."
    );
  }

  if (maxHoursPerDay === null || maxHoursPerDay <= 0) {
    errors.push(
      language === "en"
        ? "Maximum hours per day must be a positive number."
        : "Οι μέγιστες ώρες ανά ημέρα πρέπει να είναι θετικός αριθμός."
    );
  }

  if (form.workRules.targetHoursPerDay.trim() && targetHoursPerDay === null) {
    errors.push(
      language === "en"
        ? "Target hours per working day must be a number."
        : "Ο στόχος ωρών ανά εργάσιμη ημέρα πρέπει να είναι αριθμός."
    );
  }

  if (targetHoursPerDay !== null && targetHoursPerDay <= 0) {
    errors.push(
      language === "en"
        ? "Target hours per working day must be a positive number."
        : "Ο στόχος ωρών ανά εργάσιμη ημέρα πρέπει να είναι θετικός αριθμός."
    );
  }

  if (
    maxHoursPerDay !== null &&
    targetHoursPerDay !== null &&
    targetHoursPerDay > maxHoursPerDay
  ) {
    errors.push(
      language === "en"
        ? "Target hours per working day cannot exceed maximum hours per day."
        : "Ο στόχος ωρών ανά εργάσιμη ημέρα δεν μπορεί να ξεπερνά τις μέγιστες ώρες ανά ημέρα."
    );
  }

  return errors;
}

export function validateTimeOffFormForLanguage(
  form: TimeOffForm,
  employees: Employee[],
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (
    !form.employeeId ||
    !employees.some((employee) => employee.id === form.employeeId)
  ) {
    errors.push(
      language === "en" ? "Choose an employee." : "Επιλέξτε εργαζόμενο."
    );
  }

  if (!form.dateFrom) {
    errors.push(
      language === "en"
        ? "Date from is required."
        : "Η ημερομηνία έναρξης είναι υποχρεωτική."
    );
  }

  if (!form.dateTo) {
    errors.push(
      language === "en"
        ? "Date to is required."
        : "Η ημερομηνία λήξης είναι υποχρεωτική."
    );
  }

  if (form.dateFrom && form.dateTo && form.dateTo < form.dateFrom) {
    errors.push(
      language === "en"
        ? "Date to cannot be before date from."
        : "Η ημερομηνία λήξης δεν μπορεί να είναι πριν την ημερομηνία έναρξης."
    );
  }

  if (!timeOffTypeOptions(language).some((type) => type.value === form.type)) {
    errors.push(
      language === "en"
        ? "Choose a valid time off type."
        : "Επιλέξτε έγκυρο τύπο άδειας."
    );
  }

  return errors;
}
