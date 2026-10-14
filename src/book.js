// src/book.js — book_table / cancel_booking (Kvali KVA-92): book one table after the user confirmed.
// The chain is what ontopo's own checkout page does: a checkout for the exact slot (as
// create_checkout_link) → the page's settings (card? SMS code?) → checkoutContact → checkoutComplete.
// Checkouts that ask for a card or an SMS code are never completed here.
// Answers carry a status and the ticket only, never the guest's details.
import { ontopoClient, readCheckoutPage } from "./api/ontopo-client.js";

export { readCheckoutPage };

const VENUE = /^\d{4,12}$/;
const TICKET = /^[A-Za-z0-9_-]{6,40}$/;
const CHECKOUT = /^[A-Za-z0-9_-]{4,40}$/;

/** 05… for an Israeli number given as +9725…, 9725… or 05… (what ontopo's form takes, with region_code "il"). */
export function toLocalPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
}

/** The area that offers a seat at exactly this time (HHMM): the asked one, else the first. Never another time. */
export function pickArea(availData, hhmm, areaPreference) {
  const areas = (availData?.areas || []).filter((a) =>
    (a.options || []).some((o) => o.time === hhmm && o.method === "seat"));
  if (!areaPreference) return areas[0] || null;
  const want = areaPreference.trim().toLowerCase();
  return areas.find((a) => a.id === areaPreference || String(a.name || "").trim().toLowerCase() === want) || null;
}

/** A checkout for the exact tapped slot, with the page's card / SMS settings. */
export async function openCheckout({ venue_id, date, time, partySize, areaPreference, locale = "he" }, client = ontopoClient) {
  try {
    const profile = await client.getVenueProfile(venue_id, locale);
    const page = (profile?.pages || []).find((p) => p.content_type === "reservation");
    if (!page) return { status: "failed" };
    const hhmm = time.replace(":", "");
    const avail = await client.searchAvailability(page.slug, date, hhmm, partySize, locale, venue_id);
    const area = pickArea(avail, hhmm, areaPreference);
    if (!area) return { status: "slot_taken" };
    const checkout_id = await client.createCheckoutSession(
      page.slug, date, hhmm, partySize, area.id, avail.availability_id, locale, venue_id);
    const info = await client.getCheckoutInfo(checkout_id);
    if (!info) return { status: "failed" };
    return { status: "ready", checkout_id, needCredit: info.needCredit, skipVerification: info.skipVerification, area: area.name };
  } catch (err) {
    console.error(`[ontopo] book: checkout for ${venue_id} failed: ${err.message}`);
    return { status: "failed" };
  }
}

function validInput({ venue_id, date, time, partySize, customer }) {
  return VENUE.test(venue_id || "") && /^\d{4}-\d{2}-\d{2}$/.test(date || "") && /^\d{2}:\d{2}$/.test(time || "") &&
    Number.isInteger(partySize) && partySize >= 1 && partySize <= 30 &&
    Boolean(customer?.first_name?.trim()) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer?.email || "") &&
    /^0\d{8,9}$/.test(toLocalPhone(customer?.phone));
}

/** Never retried by the caller: one call = at most one booking. */
export async function bookTable(args, client = ontopoClient) {
  if (!validInput(args)) return { status: "failed" };
  const { customer } = args;

  // Reuse the summary's checkout while ontopo still serves it; otherwise open a new one for the same slot.
  let checkout = null;
  if (args.checkout_id && CHECKOUT.test(args.checkout_id)) {
    const info = await client.getCheckoutInfo(args.checkout_id);
    if (info) checkout = { status: "ready", checkout_id: args.checkout_id, ...info };
  }
  if (!checkout) checkout = await openCheckout(args, client);
  if (checkout.status !== "ready") return { status: checkout.status };
  if (checkout.needCredit) return { status: "needs_card" };
  if (!checkout.skipVerification) return { status: "needs_verification" };

  const contacted = await client.checkoutContact({
    first_name: customer.first_name.trim(),
    last_name: (customer.last_name || "").trim(),
    email: customer.email,
    phone: toLocalPhone(customer.phone),
    region_code: "il",
    checkout_id: checkout.checkout_id,
  });
  if (!contacted) return { status: "failed" };
  const ticket = await client.checkoutComplete({ comments: "", email: customer.email, checkout_id: checkout.checkout_id });
  if (!ticket || !TICKET.test(ticket.ticketId)) return { status: "failed" };
  return { status: "confirmed", reference: ticket.ticketId, manage_url: ticket.ticketUrl };
}

export async function cancelBooking({ reference }, client = ontopoClient) {
  if (!TICKET.test(reference || "")) return { status: "failed" };
  return { status: (await client.ticketReply(reference, "cancel")) ? "cancelled" : "failed" };
}
