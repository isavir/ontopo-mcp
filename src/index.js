#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchAvailabilityTool } from "./tools/search-availability.js";
import { createCheckoutLinkTool } from "./tools/create-checkout-link.js";
import { bookTableTool } from "./tools/book-table.js";
import { cancelBookingTool } from "./tools/cancel-booking.js";

const server = new McpServer({
  name: "ontopo",
  version: "0.2.0",
});

// Register search_restaurant_availability
server.tool(
  searchAvailabilityTool.name,
  searchAvailabilityTool.description,
  searchAvailabilityTool.inputSchema,
  searchAvailabilityTool.execute
);

// Register create_checkout_link
server.tool(
  createCheckoutLinkTool.name,
  createCheckoutLinkTool.description,
  createCheckoutLinkTool.inputSchema,
  createCheckoutLinkTool.execute
);

// Register book_table and cancel_booking (writes; MCP hints say so)
for (const tool of [bookTableTool, cancelBookingTool]) {
  server.registerTool(tool.name,
    { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    tool.execute);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ontopo MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
