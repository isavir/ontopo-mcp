// What one availability_search answer means. Pure (no imports), so it is testable without node_modules.

export function getStatusText(method) {
  const statusMap = {
    seat: "Book now",
    standby: "Waiting list",
    disabled: "Unavailable",
    phone: "Call to book",
    walkin: "Walk-in only",
    callback: "Request callback",
    link: "External booking",
  };
  return statusMap[method] || method;
}

const hhmm = (t) => `${t.slice(0, 2)}:${t.slice(2)}`;

/**
 * availability_search answer → result.availability.
 * - areas with options → time slots per area (bookable = method "seat");
 * - method "phone" (the venue takes reservations by phone only) → available: false, phone_only: true;
 * - anything else without areas → available: false. An answer with no slots is never "available".
 */
export function readAvailability(data, phone = null) {
  if (data?.method === "phone") {
    return {
      available: false,
      phone_only: true,
      phone: phone || null,
      reason: "Reservations can only be made by phone",
      availabilityId: data.availability_id || null,
    };
  }
  if (data?.page && Array.isArray(data?.areas)) {
    const areas = data.areas.map((area) => ({
      id: area.id,
      name: area.name,
      icon: area.icon,
      description: area.text || null,
      score: area.score, // 1=best, 5=unavailable
      timeSlots: (area.options || []).map((opt) => ({
        time: hhmm(opt.time),
        timeValue: opt.time,
        method: opt.method, // seat, standby, disabled, phone, etc.
        status: opt.text || getStatusText(opt.method),
        score: opt.score,
        bookable: opt.method === "seat",
        waitlist: opt.method === "standby",
      })),
    }));
    const recommended =
      data.recommended?.map((rec) => ({
        area: rec.text || rec.id,
        areaId: rec.id,
        time: hhmm(rec.time),
        method: rec.method,
      })) || [];
    return {
      available: areas.some((a) => a.timeSlots.some((t) => t.bookable)),
      title: data.page?.title || null,
      subtitle: data.page?.subtitle || null,
      areas,
      recommended,
    };
  }
  if (data?.availability_id) {
    return {
      available: false,
      reason: "No bookable time slots returned",
      availabilityId: data.availability_id,
    };
  }
  return { available: false, reason: "Could not load availability data" };
}
