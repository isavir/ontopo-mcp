// node --test test/  (npm test)
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bookTable, cancelBooking, openCheckout, pickArea, readCheckoutPage, toLocalPhone } from "../src/book.js";
import { ontopoClient } from "../src/api/ontopo-client.js";

const CUSTOMER = { first_name: "Dana", last_name: "Levi", phone: "+972501234567", email: "dana@example.com" };
const ARGS = { venue_id: "67408975", date: "2026-10-20", time: "18:45", partySize: 2, areaPreference: "בפנים", customer: CUSTOMER };
const AVAIL = {
  availability_id: "av1",
  areas: [
    { id: "בר", name: "בר", options: [{ time: "1845", method: "seat" }] },
    { id: "בפנים", name: "בפנים", options: [{ time: "1830", method: "seat" }, { time: "1845", method: "seat" }] },
  ],
  recommended: [{ id: "בר", time: "1900" }],
};

function fakeClient({ avail = AVAIL, info = { needCredit: false, skipVerification: true }, contact = true,
  complete = { ticketId: "7qkX73dDm6L3M6GbzMZj", ticketUrl: "https://ontopo.com/ticket/7qkX73dDm6L3M6GbzMZj" },
  pages = [{ content_type: "reservation", slug: "95480596" }], checkoutFails } = {}) {
  const calls = { checkout: [], info: [], contact: [], complete: [] };
  return {
    calls,
    getVenueProfile: async () => ({ title: "Barbunia", pages }),
    searchAvailability: async () => avail,
    createCheckoutSession: async (...a) => { calls.checkout.push(a); if (checkoutFails) throw new Error("down"); return "ck1"; },
    getCheckoutInfo: async (id) => { calls.info.push(id); return info; },
    checkoutContact: async (p) => { calls.contact.push(p); return contact; },
    checkoutComplete: async (p) => { calls.complete.push(p); return complete; },
  };
}

// ── choosing the exact tapped slot ───────────────────────────────────────────

test("pickArea: the asked area at the exact time; never ontopo's recommended time", () => {
  assert.equal(pickArea(AVAIL, "1845", "בפנים").id, "בפנים");
  assert.equal(pickArea(AVAIL, "1845", null).id, "בר");   // first area with that exact time
  assert.equal(pickArea(AVAIL, "1830", "בר"), null);      // the bar has no 18:30
  assert.equal(pickArea(AVAIL, "1900", null), null);      // recommended only, not offered as a seat
  assert.equal(pickArea({ areas: [{ id: "a", name: "a", options: [{ time: "1845", method: "phone" }] }] }, "1845", null), null);
});

test("openCheckout: the tapped time and area; the card rule comes with it", async () => {
  const c = fakeClient({ info: { needCredit: true, skipVerification: true } });
  const out = await openCheckout(ARGS, c);
  assert.deepEqual(out, { status: "ready", checkout_id: "ck1", needCredit: true, skipVerification: true, area: "בפנים" });
  assert.deepEqual(c.calls.checkout, [["95480596", "2026-10-20", "1845", 2, "בפנים", "av1", "he", "67408975"]]);
});

test("openCheckout: time gone → slot_taken; no reservation page or a failure → failed", async () => {
  assert.deepEqual(await openCheckout({ ...ARGS, time: "20:00" }, fakeClient()), { status: "slot_taken" });
  assert.deepEqual(await openCheckout(ARGS, fakeClient({ pages: [] })), { status: "failed" });
  assert.deepEqual(await openCheckout(ARGS, fakeClient({ checkoutFails: true })), { status: "failed" });
});

// ── booking ──────────────────────────────────────────────────────────────────

test("no card, no SMS code → contact + complete → confirmed with the ticket", async () => {
  const c = fakeClient();
  const out = await bookTable(ARGS, c);
  assert.deepEqual(out, { status: "confirmed", reference: "7qkX73dDm6L3M6GbzMZj",
    manage_url: "https://ontopo.com/ticket/7qkX73dDm6L3M6GbzMZj" });
  assert.deepEqual(c.calls.contact, [{ first_name: "Dana", last_name: "Levi", email: "dana@example.com",
    phone: "0501234567", region_code: "il", checkout_id: "ck1" }]);
  assert.deepEqual(c.calls.complete, [{ comments: "", email: "dana@example.com", checkout_id: "ck1" }]);
});

test("a fresh checkout from the summary is reused (no new one)", async () => {
  const c = fakeClient();
  await bookTable({ ...ARGS, checkout_id: "ckOld" }, c);
  assert.deepEqual(c.calls.checkout, []);
  assert.deepEqual(c.calls.info, ["ckOld"]);
  assert.equal(c.calls.complete[0].checkout_id, "ckOld");
});

test("a given checkout that can't be read any more → a new one", async () => {
  const c = fakeClient();
  c.getCheckoutInfo = async (id) => { c.calls.info.push(id); return id === "ckOld" ? null : { needCredit: false, skipVerification: true }; };
  const out = await bookTable({ ...ARGS, checkout_id: "ckOld" }, c);
  assert.equal(out.status, "confirmed");
  assert.equal(c.calls.complete[0].checkout_id, "ck1");
});

test("card venue → needs_card; SMS code required → needs_verification; never contacted", async () => {
  const card = fakeClient({ info: { needCredit: true, skipVerification: true } });
  assert.deepEqual(await bookTable(ARGS, card), { status: "needs_card" });
  const sms = fakeClient({ info: { needCredit: false, skipVerification: false } });
  assert.deepEqual(await bookTable(ARGS, sms), { status: "needs_verification" });
  assert.deepEqual([...card.calls.contact, ...sms.calls.contact], []);
});

test("unreadable checkout page, contact or complete refused → failed", async () => {
  assert.deepEqual(await bookTable(ARGS, fakeClient({ info: null })), { status: "failed" });
  const noContact = fakeClient({ contact: false });
  assert.deepEqual(await bookTable(ARGS, noContact), { status: "failed" });
  assert.deepEqual(noContact.calls.complete, []);
  assert.deepEqual(await bookTable(ARGS, fakeClient({ complete: null })), { status: "failed" });
});

test("bad input (no email, no phone, bad date) is refused before any call", async () => {
  const c = fakeClient();
  assert.deepEqual(await bookTable({ ...ARGS, customer: { ...CUSTOMER, email: "" } }, c), { status: "failed" });
  assert.deepEqual(await bookTable({ ...ARGS, customer: { ...CUSTOMER, phone: "12" } }, c), { status: "failed" });
  assert.deepEqual(await bookTable({ ...ARGS, date: "20/10" }, c), { status: "failed" });
  assert.deepEqual(c.calls.checkout, []);
});

test("the answer carries no guest details", async () => {
  const out = JSON.stringify(await bookTable(ARGS, fakeClient()));
  for (const v of ["Dana", "Levi", "501234567", "dana@"]) assert.ok(!out.includes(v), v);
});

test("cancelBooking → cancelled | failed", async () => {
  assert.deepEqual(await cancelBooking({ reference: "7qkX73dDm6L3M6GbzMZj" }, { ticketReply: async () => true }), { status: "cancelled" });
  assert.deepEqual(await cancelBooking({ reference: "7qkX73dDm6L3M6GbzMZj" }, { ticketReply: async () => false }), { status: "failed" });
  assert.deepEqual(await cancelBooking({ reference: "../x" }, { ticketReply: async () => true }), { status: "failed" });
});

// ── helpers and the client's new calls ───────────────────────────────────────

test("toLocalPhone", () => {
  assert.equal(toLocalPhone("+972501234567"), "0501234567");
  assert.equal(toLocalPhone("972501234567"), "0501234567");
  assert.equal(toLocalPhone("050-123-4567"), "0501234567");
});

test("readCheckoutPage: the card and SMS flags from the server-rendered checkout", () => {
  const html = '<script>window.__NUXT__={"needCredit":false,"x":1,"skipVerification":true,"expiration":485}</script>';
  assert.deepEqual(readCheckoutPage(html), { needCredit: false, skipVerification: true, expiresIn: 485 });
  assert.equal(readCheckoutPage("<html>expired</html>"), null);
});

const realFetch = globalThis.fetch;
let seen;
let reply;
beforeEach(() => {
  seen = [];
  ontopoClient._jwtToken = "tok";
  ontopoClient._tokenExpiresAt = Date.now() + 60_000;
  globalThis.fetch = async (url, init = {}) => { seen.push({ url, method: init.method || "GET", headers: init.headers, body: init.body }); return reply(url); };
});
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body, status = 200) => () => new Response(JSON.stringify(body), { status });

test("client: contact, complete and cancel go to ontopo's checkout API with the anonymous token", async () => {
  reply = json({ statusCode: 200, message: "OK", data: { hash: "h" } });
  assert.equal(await ontopoClient.checkoutContact({ checkout_id: "ck1" }), true);
  assert.equal(seen[0].url, "https://s1.ontopo.com/api/checkoutContact");
  assert.equal(seen[0].headers.token, "tok");

  reply = json({ statusCode: 200, data: { ticketUrl: "https://ontopo.com/ticket/T1", ticketId: "T1" } });
  assert.deepEqual(await ontopoClient.checkoutComplete({ checkout_id: "ck1" }), { ticketId: "T1", ticketUrl: "https://ontopo.com/ticket/T1" });
  assert.equal(seen[1].url, "https://s1.ontopo.com/api/checkoutComplete");

  reply = json({ statusCode: 200, message: "OK", data: null });
  assert.equal(await ontopoClient.ticketReply("T1", "cancel"), true);
  assert.equal(seen[2].url, "https://s2.ontopo.com/api/ticketReply");
  assert.deepEqual(JSON.parse(seen[2].body), { action: "cancel", ticketId: "T1", data: null });
});

test("client: a refused or failed write is false/null, never a throw", async () => {
  reply = json({ statusCode: 400, message: "bad" });
  assert.equal(await ontopoClient.checkoutContact({ checkout_id: "ck1" }), false);
  assert.equal(await ontopoClient.checkoutComplete({ checkout_id: "ck1" }), null);
  reply = () => { throw new Error("reset"); };
  assert.equal(await ontopoClient.ticketReply("T1", "cancel"), false);
  assert.equal(await ontopoClient.getCheckoutInfo("ck1"), null);
});
