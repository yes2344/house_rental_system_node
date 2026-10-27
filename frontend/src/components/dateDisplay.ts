import type { Locale } from "../i18n";

function parseAddisDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+03:00`)
    : new Date(value);
}

export function formatAddisDate(value: string, locale: Locale): string {
  const date = parseAddisDate(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-ET", {
    dateStyle: "medium",
    timeZone: "Africa/Addis_Ababa",
  }).format(date);
}

export function addisDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${partValue("year")}-${partValue("month")}-${partValue("day")}`;
}
