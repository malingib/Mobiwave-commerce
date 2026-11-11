const NAIROBI_TIME_ZONE = "Africa/Nairobi";

/**
 * Daraja expects YYYYMMDDHHmmss in the shortcode's local timezone.
 * Safaricom's Daraja timestamps are Nairobi time (EAT, UTC+3), not the
 * Vercel host's timezone.
 */
export function formatDarajaTimestamp(date: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("A valid date is required to format a Daraja timestamp.");
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}
