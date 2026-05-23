import type { Employee, Role } from "../../../types";
import type { UiLanguage } from "../../utils/localization";
import type { EmployeeForm, TimeOffForm } from "./employeeTypes";
import { parseOptionalNumber } from "./employeeForms";
import { timeOffTypeOptions } from "./employeeFormatters";

export function validateEmployeeFormForLanguage(
  form: EmployeeForm,
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.firstName.trim()) {
    errors.push(language === "en" ? "First name is required." : "Ξ¤ΞΏ ΟΞ½ΞΏΞΌΞ± ΞµΞ―Ξ½Ξ±ΞΉ Ο…Ο€ΞΏΟ‡ΟΞµΟ‰Ο„ΞΉΞΊΟ.");
  }

  if (!form.lastName.trim()) {
    errors.push(language === "en" ? "Last name is required." : "Ξ¤ΞΏ ΞµΟ€ΟΞ½Ο…ΞΌΞΏ ΞµΞ―Ξ½Ξ±ΞΉ Ο…Ο€ΞΏΟ‡ΟΞµΟ‰Ο„ΞΉΞΊΟ.");
  }

  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push(language === "en" ? "Enter a valid email." : "Ξ£Ο…ΞΌΟ€Ξ»Ξ·ΟΟΟƒΟ„Ξµ Ξ­Ξ³ΞΊΟ…ΟΞΏ email.");
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
        : "ΞΞΉ Ξ·ΞΌΞ­ΟΞµΟ‚ / ΞµΞ²Ξ΄ΞΏΞΌΞ¬Ξ΄Ξ± Ο€ΟΞ­Ο€ΞµΞΉ Ξ½Ξ± ΞµΞ―Ξ½Ξ±ΞΉ Ξ±Ο€Ο 1 Ξ­Ο‰Ο‚ 7."
    );
  }

  if (preferredHoursPerDay === null || preferredHoursPerDay <= 0) {
    errors.push(
      language === "en"
        ? "Hours / day must be a positive number."
        : "ΞΞΉ ΟΟΞµΟ‚ / Ξ·ΞΌΞ­ΟΞ± Ο€ΟΞ­Ο€ΞµΞΉ Ξ½Ξ± ΞµΞ―Ξ½Ξ±ΞΉ ΞΈΞµΟ„ΞΉΞΊΟΟ‚ Ξ±ΟΞΉΞΈΞΌΟΟ‚."
    );
  }

  if (contractHours === null || contractHours <= 0) {
    errors.push(
      language === "en"
        ? "Hours / week must be a positive number."
        : "ΞΞΉ ΟΟΞµΟ‚ / ΞµΞ²Ξ΄ΞΏΞΌΞ¬Ξ΄Ξ± Ο€ΟΞ­Ο€ΞµΞΉ Ξ½Ξ± ΞµΞ―Ξ½Ξ±ΞΉ ΞΈΞµΟ„ΞΉΞΊΟΟ‚ Ξ±ΟΞΉΞΈΞΌΟΟ‚."
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
        : "ΞΞΉ ΞΌΞ­Ξ³ΞΉΟƒΟ„ΞµΟ‚ ΟƒΟ…Ξ½ΞµΟ‡ΟΞΌΞµΞ½ΞµΟ‚ Ξ·ΞΌΞ­ΟΞµΟ‚ Ο€ΟΞ­Ο€ΞµΞΉ Ξ½Ξ± ΞµΞ―Ξ½Ξ±ΞΉ Ξ±Ο€Ο 1 Ξ­Ο‰Ο‚ 7."
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

  if (!form.employeeId || !employees.some((employee) => employee.id === form.employeeId)) {
    errors.push(language === "en" ? "Choose an employee." : "Ξ•Ο€ΞΉΞ»Ξ­ΞΎΟ„Ξµ ΞµΟΞ³Ξ±Ξ¶ΟΞΌΞµΞ½ΞΏ.");
  }

  if (!form.dateFrom) {
    errors.push(
      language === "en"
        ? "Date from is required."
        : "Ξ— Ξ·ΞΌΞµΟΞΏΞΌΞ·Ξ½Ξ―Ξ± Ξ­Ξ½Ξ±ΟΞΎΞ·Ο‚ ΞµΞ―Ξ½Ξ±ΞΉ Ο…Ο€ΞΏΟ‡ΟΞµΟ‰Ο„ΞΉΞΊΞ®."
    );
  }

  if (!form.dateTo) {
    errors.push(
      language === "en"
        ? "Date to is required."
        : "Ξ— Ξ·ΞΌΞµΟΞΏΞΌΞ·Ξ½Ξ―Ξ± Ξ»Ξ®ΞΎΞ·Ο‚ ΞµΞ―Ξ½Ξ±ΞΉ Ο…Ο€ΞΏΟ‡ΟΞµΟ‰Ο„ΞΉΞΊΞ®."
    );
  }

  if (form.dateFrom && form.dateTo && form.dateTo < form.dateFrom) {
    errors.push(
      language === "en"
        ? "Date to cannot be before date from."
        : "Ξ— Ξ·ΞΌΞµΟΞΏΞΌΞ·Ξ½Ξ―Ξ± Ξ»Ξ®ΞΎΞ·Ο‚ Ξ΄ΞµΞ½ ΞΌΟ€ΞΏΟΞµΞ― Ξ½Ξ± ΞµΞ―Ξ½Ξ±ΞΉ Ο€ΟΞΉΞ½ Ο„Ξ·Ξ½ Ξ·ΞΌΞµΟΞΏΞΌΞ·Ξ½Ξ―Ξ± Ξ­Ξ½Ξ±ΟΞΎΞ·Ο‚."
    );
  }

  if (!timeOffTypeOptions(language).some((type) => type.value === form.type)) {
    errors.push(language === "en" ? "Choose a valid time off type." : "Ξ•Ο€ΞΉΞ»Ξ­ΞΎΟ„Ξµ Ξ­Ξ³ΞΊΟ…ΟΞΏ Ο„ΟΟ€ΞΏ Ξ¬Ξ΄ΞµΞΉΞ±Ο‚.");
  }

  return errors;
}
