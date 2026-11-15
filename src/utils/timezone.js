/**
 * Utility functions for timezone-aware business day range and date string calculations.
 * Pure JavaScript using ECMAScript standard Intl APIs — zero external dependencies.
 */

/**
 * Returns the local date string (YYYY-MM-DD) for a given timestamp in the specified IANA timezone.
 *
 * @param {Date|number|string} [date=new Date()]
 * @param {string} [timeZone="Asia/Kolkata"]
 * @returns {string} Formatted "YYYY-MM-DD"
 */
const getLocalBusinessDateString = (date = new Date(), timeZone = "Asia/Kolkata") => {
  try {
    const d = new Date(date);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find((p) => p.type === "year").value;
    const month = parts.find((p) => p.type === "month").value;
    const day = parts.find((p) => p.type === "day").value;
    return `${year}-${month}-${day}`;
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
};

/**
 * Calculates the exact UTC Date objects corresponding to the start of day (00:00:00.000)
 * and end of day (23:59:59.999) in the business's specified IANA timezone.
 *
 * @param {Date|string} [date=new Date()]
 * @param {string} [timeZone="Asia/Kolkata"]
 * @returns {{ startOfDay: Date, endOfDay: Date, dateStr: string }}
 */
const getBusinessDayRange = (date = new Date(), timeZone = "Asia/Kolkata") => {
  const tz = timeZone || "Asia/Kolkata";
  let dateStr;

  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    dateStr = date;
  } else {
    dateStr = getLocalBusinessDateString(date, tz);
  }

  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // UTC midnight baseline guess
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });

    const parts = formatter.formatToParts(guess);
    const getPart = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
    const pYear = getPart("year");
    const pMonth = getPart("month");
    const pDay = getPart("day");
    let pHour = getPart("hour");
    if (pHour === 24) pHour = 0;
    const pMinute = getPart("minute");
    const pSecond = getPart("second");

    const localAtGuess = Date.UTC(pYear, pMonth - 1, pDay, pHour, pMinute, pSecond);
    const targetLocal = Date.UTC(year, month - 1, day, 0, 0, 0);
    const offsetMs = localAtGuess - targetLocal;

    const startOfDay = new Date(guess.getTime() - offsetMs);
    const endOfDay = new Date(startOfDay.getTime() + 86400000 - 1);

    return { startOfDay, endOfDay, dateStr };
  } catch {
    // Fallback to UTC if timezone is invalid
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    return { startOfDay, endOfDay, dateStr };
  }
};

module.exports = {
  getLocalBusinessDateString,
  getBusinessDayRange,
};
