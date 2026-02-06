const API_BASE = "https://ontopo.com/api";
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

}

export const ontopoClient = new OntopoClient();
