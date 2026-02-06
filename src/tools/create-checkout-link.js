import { z } from "zod";
import { ontopoClient } from "../api/ontopo-client.js";

export const createCheckoutLinkTool = {
  name: "create_checkout_link",
  description:
    "Create a direct checkout link for a restaurant reservation. " +
    "Returns a ready-to-book URL (s1.ontopo.com/checkout/...) for a specific " +
    "seating area and time slot. Use this after searching availability to get " +
    "a direct booking link.",
  inputSchema: {
    restaurantName: z
      .string()
      .describe("Restaurant name to search for (e.g., 'Radler', 'Chacoli')"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Reservation date in YYYY-MM-DD format"),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe("Time in HH:MM format (24-hour)"),
    partySize: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(2)
      .describe("Number of guests (default: 2)"),
    areaPreference: z
      .string()
      .optional()
      .describe(
        "Preferred seating area (e.g., 'Bar', 'Outside', 'Terrace'). " +
          "If not specified, uses the first recommended area."
      ),
    locale: z
      .enum(["en", "he"])
      .default("en")
      .describe("Language (default: en)"),
  },

  async execute({
    restaurantName,
    date,
    time,
    partySize,
    areaPreference,
    locale,
  }) {
    // Step 1: Search for the restaurant
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

    const venue = venues[0];

    // Step 2: Get venue profile to find reservation page
    const profile = await ontopoClient.getVenueProfile(venue.slug, locale);
    const reservationPages = (profile.pages || []).filter(
      (p) => p.content_type === "reservation"
    );

    if (reservationPages.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Restaurant "${venue.title}" does not accept online reservations.`,
          },
        ],
      };
    }

    const page = reservationPages[0];

    // Step 3: Get availability with areas
    const availData = await ontopoClient.searchAvailability(
      page.slug,
      date,
      time,
      partySize,
      locale,
      venue.slug
    );

    if (!availData?.areas || availData.areas.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No availability found for ${venue.title} on ${date} at ${time}.`,
          },
        ],
      };
    }

    // Step 4: Select area based on preference or recommendation
    let selectedArea = null;
    let selectedTime = time.replace(/:/g, ""); // Convert to HHMM

    if (areaPreference) {
      // Try to match area by name (case-insensitive, partial match)
      selectedArea = availData.areas.find((area) =>
        area.name.toLowerCase().includes(areaPreference.toLowerCase())
      );
      if (!selectedArea) {
        const availableAreas = availData.areas.map((a) => a.name).join(", ");
        return {
          content: [
            {
              type: "text",
              text:
                `Area "${areaPreference}" not found. Available areas: ${availableAreas}\n\n` +
                `Try again with one of these area names, or omit areaPreference to use the recommended area.`,
            },
          ],
        };
      }
    } else {
      // Use recommended area if available
      if (availData.recommended && availData.recommended.length > 0) {
        const rec = availData.recommended[0];
        selectedArea = availData.areas.find((a) => a.id === rec.id);
        selectedTime = rec.time; // Already in HHMM format
      } else {
        // Fallback: use first area with bookable slots
        selectedArea = availData.areas.find((area) =>
          area.options.some((opt) => opt.method === "seat")
        );
      }
    }

    if (!selectedArea) {
      return {
        content: [
          {
            type: "text",
            text: `No bookable areas found for ${venue.title} on ${date} at ${time}.`,
          },
        ],
      };
    }

    // Check if the selected time is bookable in this area
    const timeSlot = selectedArea.options.find((opt) => opt.time === selectedTime);
    if (!timeSlot || timeSlot.method !== "seat") {
      const bookableTimes = selectedArea.options
        .filter((opt) => opt.method === "seat")
        .map((opt) => `${opt.time.slice(0, 2)}:${opt.time.slice(2)}`);

      if (bookableTimes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No bookable times in "${selectedArea.name}" on ${date}. Try a different area or time.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Time ${time} is not available for booking in "${selectedArea.name}".\n\n` +
              `Available times in this area: ${bookableTimes.join(", ")}\n\n` +
              `Try again with one of these times.`,
          },
        ],
      };
    }

    // Step 5: Create checkout session
    const checkoutId = await ontopoClient.createCheckoutSession(
      page.slug,
      date,
      selectedTime,
      partySize,
      selectedArea.id,
      availData.availability_id,
      locale,
      venue.slug
    );

    const checkoutUrl = `https://s1.ontopo.com/${locale}/checkout/${checkoutId}`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              restaurant: venue.title,
              address: profile.address,
              phone: profile.phone,
              date,
              time: `${selectedTime.slice(0, 2)}:${selectedTime.slice(2)}`,
              partySize,
              area: selectedArea.name,
              checkoutUrl,
              expiresIn: "This link expires in 15 minutes",
            },
            null,
            2
          ),
        },
      ],
    };
  },
};
