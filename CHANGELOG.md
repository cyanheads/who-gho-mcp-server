# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.11](changelog/0.1.x/0.1.11.md) — 2026-06-02

@cyanheads/mcp-ts-core ^0.9.16 → ^0.9.21: per-request log context fix, secret scrubbing in fetchWithTimeout, withRetry fail-fast on non-retryable errors; skill sync (api-mirror, orchestrations)

## [0.1.10](changelog/0.1.x/0.1.10.md) — 2026-05-30

enrichment adoption: search, list, and query tools now surface query echoes, result totals, applied-filter context, and empty-result guidance in a typed enrichment block

## [0.1.9](changelog/0.1.x/0.1.9.md) — 2026-05-28

mcp-ts-core ^0.9.9 → ^0.9.13: HTTP body cap (413 guard), session-init gate, quieter 401/403/400/404 logging, GET /mcp surfaces package keywords; skill sync

## [0.1.8](changelog/0.1.x/0.1.8.md) — 2026-05-24

Code simplification, mcp-ts-core ^0.9.7 → ^0.9.9, ambiguous_spatial_filter error code correction

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-05-24

Fix OData error envelope crash and missing recovery hint on indicator_not_found

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-05-23

Add hosted server endpoint — remotes block in server.json, public URL in README

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-05-23

Metadata alignment: Dockerfile restored to oven/bun:1.3, scripts migrated from tsx to bun, .env.example restructured, tsx devDependency removed

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-05-23

Sync canonical tagline across all metadata surfaces

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-05-23

Tool description fixes and metadata sync to gold standard

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-05-23

Fix indicator name resolution and document region_codes aggregate behavior

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-05-23

Initial public release — WHO GHO MCP server, 6 tools and 2 resources for 3,059 Global Health Observatory indicators across 194 member states

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-23

Initial release — WHO GHO MCP server with 6 tools and 2 resources for the Global Health Observatory OData API
