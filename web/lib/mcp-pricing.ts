export const MCP_FREE_MONTHLY_UNITS = 500;
export const MCP_FOUNDER_MONTHLY_UNITS = 5_000;

export const MCP_TOOL_UNIT_PRICING = [
  { label: "Organize library", units: 0 },
  { label: "Read paper or library", units: 1 },
  { label: "Query evidence", units: 2 },
  { label: "Discover or map citations", units: 3 },
  { label: "Compare papers", units: 5 },
] as const;

export const MCP_API_SCALE_PREVIEW = {
  priceThb: 999,
  monthlyUnits: 50_000,
  extraUnits: 10_000,
  extraPriceThb: 199,
} as const;
