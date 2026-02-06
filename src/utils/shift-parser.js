/**
 * Parses Ontopo shift data and computes available time slots.
 * Reimplements the client-side logic from Ontopo's serviceSdk.
 */

/**
 * Expand a time range string like "1900-2230" into 30-min slots.
 * Supports multiple ranges: "1200-1400,1800-2200"
 * Returns array of "HHMM" strings.
 */
function expandTimeRange(rangeStr, stepMinutes = 30) {
  const ranges = rangeStr.split(",");
  const slots = [];

  for (const range of ranges) {
    const parts = range.trim().split("-");
    const startHHMM = parseInt(parts[0], 10);
    const endHHMM = parts.length > 1 ? parseInt(parts[1], 10) : startHHMM;

    let currentMinutes = hhmmToMinutes(startHHMM);
    const endMinutes = hhmmToMinutes(endHHMM);

    while (currentMinutes <= endMinutes) {
      slots.push(minutesToHHMM(currentMinutes));
      currentMinutes += stepMinutes;
    }
  }

  return slots;
}

function hhmmToMinutes(hhmm) {
  const h = Math.floor(hhmm / 100);
  const m = hhmm % 100;
  return h * 60 + m;
}

function minutesToHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

/**
 * Format "HHMM" to "HH:MM" for display.
 */
function formatTime(hhmm) {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

/**
 * Check if a value falls within a range string like "0-3" or "5" or "0-3,6".
 */
function matchesRange(rangeStr, value) {
  const parts = rangeStr.split(",");
  for (const part of parts) {
    const bounds = part.trim().split("-");
    const low = parseInt(bounds[0], 10);
    const high = bounds.length > 1 ? parseInt(bounds[1], 10) : low;
    if (value >= low && value <= high) return true;
  }
  return false;
}

/**
 * Check if a date string (YYYYMMDD) matches a date criteria value.
 * Criteria can be a single date, range, or comma-separated list.
 */
function matchesDateCriteria(criteriaDate, dateStr) {
  return matchesRange(criteriaDate, parseInt(dateStr, 10));
}

/**
 * Find the matching opening config for a given date.
 * Later entries in the opening array override earlier ones (specificity).
 * Returns the merged opening config for the date, or null if closed.
 */
function findOpeningForDate(opening, dateStr, weekday) {
  let result = null;

  for (const entry of opening) {
    const criteria = entry.__criteria;
    if (!criteria) continue;

    let matches = true;

    if (criteria.weekday !== undefined) {
      if (!matchesRange(String(criteria.weekday), weekday)) {
        matches = false;
      }
    }

    if (criteria.date !== undefined) {
      if (!matchesDateCriteria(String(criteria.date), dateStr)) {
        matches = false;
      }
    }

    if (matches) {
      // Later matches override earlier ones (date-specific overrides weekday)
      if (result === null) {
        result = { ...entry };
      } else {
        result = { ...result, ...entry };
      }
    }
  }

  if (!result) return null;

  // Remove internal criteria field
  delete result.__criteria;
  return result;
}

/**
 * Compute available time slots for a given date and party size.
 *
 * @param {object} shiftsData - The shifts object from slug_content response
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} requestedTime - Preferred time in HH:MM format
 * @param {number} partySize - Number of guests
 * @param {number} tzOffset - Venue timezone offset in minutes (e.g., 120 for UTC+2)
 * @returns {object} Available time slots and metadata
 */
export function computeAvailableSlots(
  shiftsData,
  dateStr,
  requestedTime,
  partySize,
  tzOffset = 120
) {
  if (!shiftsData?.shifts) {
    return { available: false, reason: "No shift data available" };
  }

  const shifts = shiftsData.shifts;
  const tags = shiftsData.tags || {};
  const opening = shifts.opening;

  if (!opening || opening.length === 0) {
    return { available: false, reason: "No opening hours defined" };
  }

  // Convert date to YYYYMMDD and get weekday
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day);
  const weekday = dateObj.getDay(); // 0=Sun, 6=Sat
  const dateCompact = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;

  // Find matching opening config
  const openingConfig = findOpeningForDate(opening, dateCompact, weekday);

  if (!openingConfig) {
    return { available: false, reason: "Restaurant closed on this date" };
  }

  // Check for "close" tag
  if (openingConfig.tag) {
    const tagInfo = tags[openingConfig.tag];
    if (tagInfo?.action === "disabled") {
      return {
        available: false,
        reason: tagInfo.text || "Restaurant closed on this date",
      };
    }
  }

  // Check party size constraints
  const sizeConfig = shifts.size;
  if (sizeConfig) {
    if (partySize < (sizeConfig.min || 1)) {
      return { available: false, reason: `Minimum party size is ${sizeConfig.min}` };
    }
    if (partySize > (sizeConfig.max || 20)) {
      const sizeEntry = sizeConfig[String(sizeConfig.max)];
      const tagInfo = sizeEntry?.tag ? tags[sizeEntry.tag] : null;
      return {
        available: false,
        reason: tagInfo?.text || `Maximum party size is ${sizeConfig.max}`,
      };
    }
    // Check if this specific size has a special tag
    const sizeEntry = sizeConfig[String(partySize)];
    if (sizeEntry?.tag) {
      const tagInfo = tags[sizeEntry.tag];
      if (tagInfo?.action === "disabled") {
        return {
          available: false,
          reason: tagInfo.text || `Party size ${partySize} not available online`,
        };
      }
    }
  }

  // Extract hours from the opening config
  if (!openingConfig.hours) {
    return { available: false, reason: "No hours defined for this date" };
  }

  const step = shifts.time?.step || 30;
  const lastTime = openingConfig.last;

  // Expand all hour groups into time slots
  const allSlots = [];
  const hourKeys = Object.keys(openingConfig.hours).filter(
    (k) => openingConfig.hours[k] != null
  );

  for (const key of hourKeys) {
    const hourDef = openingConfig.hours[key];
    if (!hourDef?.time) continue;

    const expanded = expandTimeRange(hourDef.time, step);
    for (const slot of expanded) {
      allSlots.push({
        time: slot,
        group: key,
        tag: hourDef.tag || null,
        duration: hourDef.duration || null,
      });
    }
  }

  // Sort by time
  allSlots.sort((a, b) => a.time.localeCompare(b.time));

  // Deduplicate (later groups override)
  const slotMap = new Map();
  for (const slot of allSlots) {
    slotMap.set(slot.time, slot);
  }

  // Check if the requested date is today (in venue timezone)
  const now = new Date();
  const venueNow = new Date(now.getTime() + (tzOffset + now.getTimezoneOffset()) * 60_000);
  const venueToday = `${venueNow.getFullYear()}${String(venueNow.getMonth() + 1).padStart(2, "0")}${String(venueNow.getDate()).padStart(2, "0")}`;
  const isToday = dateCompact === venueToday;

  // Compute earliest bookable time for today
  let earliestTime = "0000";
  if (isToday) {
    const venueHHMM = `${String(venueNow.getHours()).padStart(2, "0")}${String(venueNow.getMinutes()).padStart(2, "0")}`;

    // Check offService
    if (openingConfig.offService?.time) {
      if (parseInt(openingConfig.offService.time) <= parseInt(venueHHMM)) {
        return {
          available: false,
          reason:
            openingConfig.offService.title ||
            "Booking for today is no longer available",
          description: openingConfig.offService.description,
        };
      }
    }

    // Apply hoursAhead
    const hoursAhead = openingConfig.hoursAhead || 0;
    const aheadMinutes = hoursAhead * 60;
    const currentMinutes =
      venueNow.getHours() * 60 + venueNow.getMinutes() + aheadMinutes;
    earliestTime = minutesToHHMM(Math.ceil(currentMinutes / step) * step);
  }

  // Filter to enabled slots
  const availableSlots = [];
  for (const [time, slot] of slotMap) {
    let enabled = true;
    let label = formatTime(time);
    let note = null;

    // Disable past times on today
    if (isToday && time < earliestTime) {
      enabled = false;
    }

    // Disable times after last bookable time
    if (lastTime && time > lastTime) {
      enabled = false;
    }

    // Handle tags
    if (slot.tag) {
      const tagInfo = tags[slot.tag];
      if (tagInfo) {
        if (tagInfo.action === "disabled") enabled = false;
        if (tagInfo.text) note = tagInfo.text;
        if (tagInfo.tag) label = `${formatTime(time)} (${tagInfo.tag})`;
      }
    }

    if (enabled) {
      const entry = { time: formatTime(time), timeValue: time };
      if (note) entry.note = note;
      if (slot.tag) {
        const tagInfo = tags[slot.tag];
        if (tagInfo?.tag) entry.tag = tagInfo.tag;
      }
      availableSlots.push(entry);
    }
  }

  if (availableSlots.length === 0) {
    return {
      available: false,
      reason: isToday
        ? "No more available time slots for today"
        : "No available time slots for this date",
    };
  }

  return {
    available: true,
    date: dateStr,
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday],
    defaultTime: openingConfig.default
      ? formatTime(openingConfig.default)
      : null,
    timeSlots: availableSlots,
    partySize,
    sizeRange: sizeConfig
      ? { min: sizeConfig.min || 1, max: sizeConfig.max || 20 }
      : null,
  };
}

/**
 * Get the booking window (available dates) from shift data.
 */
export function getBookingWindow(shiftsData) {
  if (!shiftsData?.shifts?.date) return null;
  const { daysAhead, maxDaysAhead } = shiftsData.shifts.date;
  return { daysAhead: daysAhead || 21, maxDaysAhead: maxDaysAhead || 30 };
}
