import { z } from "zod";
import { ontopoClient } from "../api/ontopo-client.js";

export const searchAvailabilityTool = {
  name: "search_restaurant_availability",
  description:
    "Search for restaurant availability on Ontopo (Israel). " +
    "Returns real-time available time slots by seating area (Bar, Terrace, etc.) " +
    "with booking status: 'Book now', 'Waiting list', or unavailable.",
  inputSchema: {
    restaurantName: z
      .string()
      .describe("Restaurant name to search for (e.g., 'Radler', 'Yassou')"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Reservation date in YYYY-MM-DD format"),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe("Preferred time in HH:MM format (24-hour)"),
    partySize: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(2)
      .describe("Number of guests (default: 2)"),
    locale: z
      .enum(["en", "he"])
      .default("en")
      .describe("Language for results (default: en)"),
  },

  async execute({ restaurantName, date, time, partySize, locale }) {
    // Step 1: Search for venues matching the name
    const venues = await ontopoClient.searchVenues(restaurantName, locale);

    if (!venues || venues.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No restaurants found matching "${restaurantName}".`,
          },
        ],
      };
    }

    // Step 2: Get detailed info for top results (max 3)
    const topVenues = venues.slice(0, 3);
    const results = [];

    for (const venue of topVenues) {
      try {
        const profile = await ontopoClient.getVenueProfile(
          venue.slug,
          locale
        );

        // Get reservation pages
        const reservationPages = (profile.pages || []).filter(
          (p) => p.content_type === "reservation"
        );

        if (reservationPages.length === 0) continue;

        const page = reservationPages[0];

        // Step 3: Get real-time availability from API
        let availabilityData = null;
        try {
          availabilityData = await ontopoClient.searchAvailability(
            page.slug,
            date,
            time,
            partySize,
            locale,
            venue.slug
          );
        } catch (err) {
          console.error(
            `Failed to get availability for ${page.slug}: ${err.message}`
          );
        }

        const result = {
          name: profile.title || venue.title,
          address: profile.address || venue.address,
          phone: profile.phone || null,
          priceRange: profile.venue_price || null,
          pageSlug: page.slug,
          venueSlug: venue.slug,
        };

        // Process availability response
        if (availabilityData?.page && availabilityData?.areas) {
          // Format areas with time slots
          const areas = availabilityData.areas.map((area) => ({
            id: area.id,
            name: area.name,
            icon: area.icon,
            description: area.text || null,
            score: area.score, // 1=best, 5=unavailable
            timeSlots: area.options.map((opt) => {
              // Format HHMM to HH:MM
              const formattedTime = `${opt.time.slice(0, 2)}:${opt.time.slice(2)}`;
              return {
                time: formattedTime,
                timeValue: opt.time,
                method: opt.method, // seat, standby, disabled, phone, etc.
                status: opt.text || getStatusText(opt.method),
                score: opt.score,
                bookable: opt.method === "seat",
                waitlist: opt.method === "standby",
              };
            }),
          }));

          // Get recommended slots
          const recommended =
            availabilityData.recommended?.map((rec) => ({
              area: rec.text || rec.id,
              areaId: rec.id,
              time: `${rec.time.slice(0, 2)}:${rec.time.slice(2)}`,
              method: rec.method,
            })) || [];

          result.availability = {
            available: areas.some((a) =>
              a.timeSlots.some((t) => t.bookable)
            ),
            title: availabilityData.page?.title || null,
            subtitle: availabilityData.page?.subtitle || null,
            areas,
            recommended,
          };
        } else if (availabilityData?.availability_id) {
          // Minimal response - no detailed availability
          result.availability = {
            available: true,
            message: "Availability confirmed, but no time slot details available",
            availabilityId: availabilityData.availability_id,
          };
        } else {
          result.availability = {
            available: false,
            reason: "Could not load availability data",
          };
        }

        // Add additional reservation pages if venue has multiple
        if (reservationPages.length > 1) {
          result.additionalPages = reservationPages.slice(1).map((p) => ({
            title: p.title || p.content_description,
            pageSlug: p.slug,
          }));
        }

        results.push(result);
      } catch (err) {
        console.error(`Failed to load venue ${venue.slug}: ${err.message}`);
      }
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Found venues matching "${restaurantName}" but could not load their details.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query: restaurantName,
              date,
              time,
              partySize,
              results,
            },
            null,
            2
          ),
        },
      ],
    };
  },
};

/**
 * Get human-readable status text from booking method
 */
function getStatusText(method) {
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
