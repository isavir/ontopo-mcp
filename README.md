# ontopo-mcp

MCP server for [Ontopo](https://ontopo.com) restaurant reservations in Israel. Search for restaurants, check real-time availability by seating area, and get direct checkout links.

## Tools

### `search_restaurant_availability`

Search for a restaurant by name and get real-time available time slots by seating area.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `restaurantName` | string | yes | Restaurant name (e.g., "Radler", "M25") |
| `date` | string | yes | Date in `YYYY-MM-DD` format |
| `time` | string | yes | Preferred time in `HH:MM` 24-hour format |
| `partySize` | number | no | Number of guests (1-20, default: 2) |
| `locale` | string | no | `"en"` or `"he"` (default: `"en"`) |

**Returns:** Matching restaurants with real-time availability per seating area (Bar, Terrace, etc.). Each time slot shows booking status: "Book now", "Waiting list", or unavailable.

### `create_checkout_link`

Create a direct checkout link for a specific seating area and time slot.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `restaurantName` | string | yes | Restaurant name (e.g., "Radler", "Chacoli") |
| `date` | string | yes | Date in `YYYY-MM-DD` format |
| `time` | string | yes | Time in `HH:MM` 24-hour format |
| `partySize` | number | no | Number of guests (1-20, default: 2) |
| `areaPreference` | string | no | Seating area (e.g., "Bar", "Outside"). Auto-selects recommended if omitted. |
| `locale` | string | no | `"en"` or `"he"` (default: `"en"`) |

**Returns:** A direct checkout URL (`s1.ontopo.com/checkout/...`) ready to complete the booking. Link expires in ~15 minutes.

## Setup

### Prerequisites

- Node.js >= 18

### Install

```bash
cd ontopo-mcp
npm install
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ontopo": {
      "command": "node",
      "args": ["/absolute/path/to/ontopo-mcp/src/index.js"]
    }
  }
}
```

> If you use a Node version manager (fnm, nvm), use the absolute path to `node` (e.g., `~/.local/share/fnm/node-versions/v22.19.0/installation/bin/node`).

### Claude Code

```bash
claude mcp add ontopo node /absolute/path/to/ontopo-mcp/src/index.js
```

## Architecture

```
src/
  index.js                     # MCP server entry point (stdio transport)
  api/
    ontopo-client.js           # HTTP client for Ontopo API
  tools/
    search-availability.js     # search_restaurant_availability tool
    create-checkout-link.js    # create_checkout_link tool
  utils/
    shift-parser.js            # Time slot computation from shift data (deprecated)
```

### How it works

1. **Venue search** (`GET /api/venue_search`) finds restaurants by name
2. **Venue profile** (`GET /api/venue_profile`) maps venue slugs to reservation page slugs
3. **Availability search** (`POST /api/availability_search`) returns real-time availability per seating area with bookable time slots, waiting lists, and recommendations
4. **Checkout session** (second `POST /api/availability_search` with area + availability_id) creates a checkout session and returns a direct booking URL

> Date/time must be sent in compact format (`YYYYMMDD`, `HHMM`) to the API — formatted versions return incomplete data.

### Ontopo API

- Base URL: `https://ontopo.com/api`
- Auth: Anonymous JWT via `POST /api/loginAnonymously` (15-min expiry, auto-refreshed)
- No API key required
- Distributor: `15171493`, version: `7738`
