import { z } from "zod";
import { bookTable } from "../book.js";

export const bookTableTool = {
  name: "book_table",
  description:
    "Book one table on Ontopo for a guest, after the user confirmed. Never call twice for one confirmation. " +
    "Books exactly the given time (and area when given); reuses checkout_id from create_checkout_link while it " +
    "is still open. Returns status confirmed | slot_taken | needs_card | needs_verification | failed, and on " +
    "confirmed the ticket id (reference) and the ticket page (manage_url). Venues that ask for a card or an " +
    "SMS code are not booked.",
  inputSchema: {
    venue_id: z.string().regex(/^\d{4,12}$/).describe("Ontopo venue slug"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
    time: z.string().regex(/^\d{2}:\d{2}$/).describe("HH:MM"),
    partySize: z.number().int().min(1).max(30),
    areaPreference: z.string().max(60).optional().describe("Area id or name from the availability answer"),
    checkout_id: z.string().max(40).optional().describe("checkout id from create_checkout_link, if still open"),
    locale: z.enum(["he", "en"]).default("he"),
    customer: z.object({
      first_name: z.string().min(1).max(80),
      last_name: z.string().max(80).optional(),
      phone: z.string().min(9).max(20),
      email: z.string().email().max(120),
    }),
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },

  async execute(args) {
    return { content: [{ type: "text", text: JSON.stringify(await bookTable(args)) }] };
  },
};
