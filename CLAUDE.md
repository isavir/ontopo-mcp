# CLAUDE.md

## Project Overview

MCP server providing restaurant availability search and reservation links for Ontopo (ontopo.com), an Israeli restaurant reservation platform. Uses stdio transport.

## Commands

- `npm start` or `node src/index.js` — run the MCP server
- `npm install` — install dependencies
- `npm test` — unit tests (`node --test`, no extra dependencies)

## Project Structure

```
src/index.js                  — MCP server, registers tools, stdio transport
src/api/ontopo-client.js      — HTTP client: venue search, profile, page content, availability, checkout, JWT auth
src/tools/search-availability.js — search_restaurant_availability tool
src/availability.js           — reads one availability_search answer (pure; tested in test/)
src/tools/create-checkout-link.js — create_checkout_link tool (direct booking URLs)
```

## Key Concepts

- **Two-slug system**: `venue_search` returns venue slugs; `venue_profile` maps them to page slugs used in URLs and `slug_content`
- **Compact date/time formats**: The availability API requires `YYYYMMDD` and `HHMM` — formatted versions (`YYYY-MM-DD`, `HH:MM`) return incomplete data without areas
- **Real-time availability**: `POST /api/availability_search` with compact formats returns areas (Bar, Terrace, etc.) with time slots showing booking status (seat/standby/disabled)
- **Checkout flow**: A second `availability_search` call with `area` + `availability_id` creates a checkout session, returning a `checkout_id` for `https://s1.ontopo.com/{locale}/checkout/{id}`
- **Phone-only venues**: `availability_search` answers `method: "phone"` with no areas → `availability: {available: false, phone_only: true, phone}`. An answer without areas is never `available: true`
- **Tags**: Defined in shift data `shifts.tags`, used to mark closed days (`action: "disabled"`), special events, or size restrictions

## Ontopo API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/venue_search` | GET | none | Search restaurants by name |
| `/api/venue_profile` | GET | none | Get venue details + page slugs |
| `/api/slug_content` | GET | none | Get page content with shift/schedule data |
| `/api/loginAnonymously` | POST | none | Get anonymous JWT (15-min expiry) |
| `/api/availability_search` | POST | JWT | Get real-time availability (areas + time slots) |
| `/api/availability_search` | POST | JWT | Create checkout session (with area + availability_id) |

## Style

- ESM modules (`"type": "module"` in package.json)
- No TypeScript, no build step
- Tools export `{ name, description, inputSchema, execute }` objects
- Zod for input validation
- Tests: `node:test` in `test/`, for pure modules only (no network)
