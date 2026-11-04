export function normalizeKenyanPhone(value: string) {
  const digits = value.replace(/\\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("7") && digits.length === 9) return `254${digits}`;
  if (digits.startsWith("1") && digits.length === 9) return `254${digits}`;
  return null;
}

export function matchesKenyanPhone(expected: string, received: string) {
  const expectedPhone = normalizeKenyanPhone(expected);
  const receivedPhone = normalizeKenyanPhone(received);
  return Boolean(expectedPhone && receivedPhone && expectedPhone === receivedPhone);
}

/** Daraja STK timestamps are generated in East Africa Time, not the Vercel host timezone. */
export function formatDarajaTimestamp(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}${value("month")}${value("day")}${value("hour")}${value("minute")}${value("second")}`;
}
