const API_BASE = "https://ontopo.com/api";
// The checkout and ticket pages' own API hosts (KVA-92 spike, docs in kvali-poc docs/providers/ontopo-booking.md)
const CHECKOUT_BASE = "https://s1.ontopo.com";
const TICKET_BASE = "https://s2.ontopo.com";
const WRITE_TIMEOUT_MS = 10_000;
const DISTRIBUTOR_SLUG = "15171493";
const DISTRIBUTOR_VERSION = 7738;
const TOKEN_REFRESH_MARGIN_MS = 60_000; // refresh 1 min before expiry

class OntopoClient {
  constructor() {
    this._jwtToken = null;
    this._tokenExpiresAt = 0;
  }

  async _ensureToken() {
    if (this._jwtToken && Date.now() < this._tokenExpiresAt) {
      return this._jwtToken;
    }
    const res = await fetch(`${API_BASE}/loginAnonymously`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = await res.json();
    this._jwtToken = data.jwt_token;
    // JWT has 15-min expiry; refresh 1 min early
    this._tokenExpiresAt = Date.now() + 14 * 60_000;
    return this._jwtToken;
  }

  /**
   * Search restaurants by name.
   * Returns array of {slug, version, title, address, logo, honors_giftcard}.
   */
  async searchVenues(terms, locale = "en") {
    const params = new URLSearchParams({
      terms,
      slug: DISTRIBUTOR_SLUG,
      version: String(DISTRIBUTOR_VERSION),
      locale,
    });
    const res = await fetch(`${API_BASE}/venue_search?${params}`);
    if (!res.ok) throw new Error(`venue_search failed: ${res.status}`);
    return res.json();
  }

  /**
   * Get venue profile (detailed info including page slugs).
   * Returns {title, address, phone, logo, geolocation, venue_price, pages[], nearby_venues[]}.
   */
  async getVenueProfile(venueSlug, locale = "en") {
    const params = new URLSearchParams({ slug: venueSlug, locale });
    const res = await fetch(`${API_BASE}/venue_profile?${params}`);
    if (!res.ok) throw new Error(`venue_profile failed: ${res.status}`);
    return res.json();
  }

  /**
   * Search availability for a restaurant page with real-time area/slot data.
   * Returns {page, areas[], recommended[], venue, availability_id}.
   *
   * @param {string} pageSlug - Restaurant page slug
   * @param {string} date - Date in YYYY-MM-DD format (will be converted to YYYYMMDD)
   * @param {string} time - Time in HH:MM format (will be converted to HHMM)
   * @param {number} size - Party size
   * @param {string} locale - Language (en/he)
   * @param {string} venueSlug - Optional venue slug for analytics
   */
  async searchAvailability(pageSlug, date, time, size, locale = "en", venueSlug = "") {
    const token = await this._ensureToken();

    // Convert to compact formats (API requirement)
    const compactDate = date.replace(/-/g, ""); // YYYY-MM-DD → YYYYMMDD
    const compactTime = time.replace(/:/g, ""); // HH:MM → HHMM

    const res = await fetch(`${API_BASE}/availability_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        token,
      },
      body: JSON.stringify({
        slug: pageSlug,
        locale,
        criteria: {
          date: compactDate,
          time: compactTime,
          size: String(size)
        },
        data: {
          analytics: {
            platform: "web",
            distributor_id: "il",
            venue_id: venueSlug,
            device_id: "mcp-client"
          }
        }
      }),
    });
    if (!res.ok) throw new Error(`availability_search failed: ${res.status}`);
    return res.json();
  }

  /**
   * Create a checkout session for a specific area and time.
   * Returns checkout_id to build the booking URL: https://s1.ontopo.com/{locale}/checkout/{id}
   *
   * @param {string} pageSlug - Restaurant page slug
   * @param {string} date - Date in YYYY-MM-DD format (will be converted to YYYYMMDD)
   * @param {string} time - Time in HHMM format (already compact)
   * @param {number} size - Party size
   * @param {string} areaId - Area ID from availability response
   * @param {string} availabilityId - Availability ID from initial availability search
   * @param {string} locale - Language
   * @param {string} venueSlug - Venue slug for analytics
   * @returns {Promise<string>} checkout_id
   */
  async createCheckoutSession(
    pageSlug,
    date,
    time,
    size,
    areaId,
    availabilityId,
    locale = "en",
    venueSlug = ""
  ) {
    const token = await this._ensureToken();

    // Convert date to compact format if needed
    const compactDate = date.replace(/-/g, ""); // YYYY-MM-DD → YYYYMMDD
    const compactTime = time.replace(/:/g, ""); // HH:MM → HHMM (if still formatted)

    const res = await fetch(`${API_BASE}/availability_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        token,
      },
      body: JSON.stringify({
        slug: pageSlug,
        locale,
        criteria: {
          date: compactDate,
          time: compactTime,
          size: String(size),
          area: areaId,
        },
        availability_id: availabilityId,
        data: {
          analytics: {
            platform: "web",
            distributor_id: "il",
            venue_id: venueSlug,
            device_id: "mcp-client",
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`checkout session creation failed: ${res.status}`);
    const data = await res.json();

    if (!data.checkout_id) {
      throw new Error("No checkout_id in response");
    }

    return data.checkout_id;
  }

  /**
   * Get page content including shift/schedule data.
   * Uses GET request with query params (unlike other POST endpoints).
   */
  async getPageContent(pageSlug, locale = "en") {
    const params = new URLSearchParams({
      slug: pageSlug,
      version: String(DISTRIBUTOR_VERSION),
      distributor: DISTRIBUTOR_SLUG,
      locale,
    });
    const res = await fetch(`${API_BASE}/slug_content?${params}`);
    if (!res.ok) throw new Error(`slug_content failed: ${res.status}`);
    return res.json();
  }


  // ── Booking in chat (KVA-92). Writes never throw and never return the raw answer. ──

  async _post(url, body) {
    const token = await this._ensureToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null);
    return res.ok && data?.statusCode === 200 ? data : null;
  }

  /** The checkout page's server-rendered settings: {needCredit, skipVerification, expiresIn} or null. */
  async getCheckoutInfo(checkoutId) {
    try {
      const res = await fetch(`${CHECKOUT_BASE}/he/checkout/${encodeURIComponent(checkoutId)}`,
        { signal: AbortSignal.timeout(WRITE_TIMEOUT_MS) });
      return res.ok ? readCheckoutPage(await res.text()) : null;
    } catch (err) {
      console.error(`[ontopo] checkout page failed: ${err.message}`);
      return null;
    }
  }

  /** The guest's details on a checkout. True when ontopo accepted them. */
  async checkoutContact(payload) {
    try {
      return Boolean(await this._post(`${CHECKOUT_BASE}/api/checkoutContact`, payload));
    } catch (err) {
      console.error(`[ontopo] checkoutContact failed: ${err.message}`);
      return false;
    }
  }

  /** Completes the booking: {ticketId, ticketUrl} or null. */
  async checkoutComplete(payload) {
    try {
      const data = await this._post(`${CHECKOUT_BASE}/api/checkoutComplete`, payload);
      const { ticketId, ticketUrl } = data?.data || {};
      return ticketId && ticketUrl ? { ticketId, ticketUrl } : null;
    } catch (err) {
      console.error(`[ontopo] checkoutComplete failed: ${err.message}`);
      return null;
    }
  }

  /** An action on a booking's ticket (e.g. "cancel"). True when ontopo accepted it. */
  async ticketReply(ticketId, action) {
    try {
      return Boolean(await this._post(`${TICKET_BASE}/api/ticketReply`, { action, ticketId, data: null }));
    } catch (err) {
      console.error(`[ontopo] ticketReply ${action} failed: ${err.message}`);
      return false;
    }
  }
}

/** Reads the flags the checkout page is rendered with; null when they aren't there (expired, changed). */
export function readCheckoutPage(html) {
  const flag = (name) => {
    const m = html.match(new RegExp(`"${name}":(true|false)`));
    return m ? m[1] === "true" : null;
  };
  const needCredit = flag("needCredit");
  const skipVerification = flag("skipVerification");
  if (needCredit === null || skipVerification === null) return null;
  const exp = html.match(/"expiration":(\d+)/);
  return { needCredit, skipVerification, expiresIn: exp ? Number(exp[1]) : null };
}

export const ontopoClient = new OntopoClient();
