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

  const contractDays = parseOptionalNumber(form.workRules.contractDaysPerWeek);
  const preferredHoursPerDay = parseOptionalNumber(
    form.workRules.preferredHoursPerDay
  );
  const contractHours = parseOptionalNumber(form.workRules.contractHoursPerWeek);
  const maxConsecutiveDays = parseOptionalNumber(
    form.workRules.maxConsecutiveDays
  );

  if (contractDays === null || contractDays < 1 || contractDays > 7) {
    errors.push(
      language === "en"
        ? "Days / week must be from 1 to 7."
        : "Οι ημέρες / εβδομάδα πρέπει να είναι από 1 έως 7."
    );
  }

  if (preferredHoursPerDay === null || preferredHoursPerDay <= 0) {
    errors.push(
      language === "en"
        ? "Hours / day must be a positive number."
        : "Οι ώρες / ημέρα πρέπει να είναι θετικός αριθμός."
    );
  }

  if (contractHours === null || contractHours <= 0) {
    errors.push(
      language === "en"
        ? "Hours / week must be a positive number."
        : "Οι ώρες / εβδομάδα πρέπει να είναι θετικός αριθμός."
    );
  }

  if (
    maxConsecutiveDays === null ||
    maxConsecutiveDays < 1 ||
    maxConsecutiveDays > 7
  ) {
    errors.push(
      language === "en"
        ? "Max consecutive days must be from 1 to 7."
        : "Οι μέγιστες συνεχόμενες ημέρες πρέπει να είναι από 1 έως 7."
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
