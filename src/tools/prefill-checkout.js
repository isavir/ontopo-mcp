import { z } from "zod";
import { prefillCheckout } from "../book.js";

export const prefillCheckoutTool = {
  name: "prefill_checkout",
  description:
    "For a venue that asks for a credit card: open a checkout for the exact slot, put the guest's details on it " +
    "and return its link, so the guest only has to enter the card on Ontopo's page. Never books and never " +
    "completes the checkout: nothing is reserved until the guest enters a card. Returns status prefilled | " +
    "slot_taken | no_card | needs_verification | failed, and on prefilled the checkout link (checkout_url) and " +
    "the seconds it stays open (expires_in, may be null). no_card means the venue asks for no card: use book_table.",
  inputSchema: {
    venue_id: z.string().regex(/^\d{4,12}$/).describe("Ontopo venue slug"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
    time: z.string().regex(/^\d{2}:\d{2}$/).describe("HH:MM"),
    partySize: z.number().int().min(1).max(30),
    areaPreference: z.string().max(60).optional().describe("Area id or name from the availability answer"),
    checkout_id: z.string().max(40).optional().describe("checkout id from create_checkout_link, if still open"),
    locale: z.enum(["he", "en"]).default("he").describe("Language of the returned checkout link"),
    customer: z.object({
      first_name: z.string().min(1).max(80),
      last_name: z.string().max(80).optional(),
      phone: z.string().min(9).max(20),
      email: z.string().email().max(120),
    }),
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },

  async execute(args) {
    return { content: [{ type: "text", text: JSON.stringify(await prefillCheckout(args)) }] };
  },
};
