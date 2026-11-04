// SCRUM-128 C14/C18: the Sync Status "Next scheduled run" text, always in IST. C14 changed the
// label from the wrong "UTC" to "IST" (the browser-local time MML's viewers saw). C18 formats the
// time explicitly in Asia/Kolkata, so a browser on any other zone also shows IST (02:00Z →
// "30 Sep, 07:30 IST"); the shown value changes only for browsers not set to IST.
const IST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatNextScheduledRun(nextCronAt: string): string {
  const parts = IST_PARTS.formatToParts(new Date(nextCronAt));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} IST`;
}
