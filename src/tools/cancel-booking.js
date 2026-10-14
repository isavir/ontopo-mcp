import { z } from "zod";
import { cancelBooking } from "../book.js";

export const cancelBookingTool = {
  name: "cancel_booking",
  description: "Cancel an Ontopo booking made by book_table, by its ticket id. Returns status cancelled | failed.",
  inputSchema: {
    reference: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/).describe("Ticket id from book_table"),
  },
  annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },

  async execute(args) {
    return { content: [{ type: "text", text: JSON.stringify(await cancelBooking(args)) }] };
  },
};
