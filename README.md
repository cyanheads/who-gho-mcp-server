<div align="center">
  <h1>@cyanheads/who-gho-mcp-server</h1>
  <p><b>Query WHO Global Health Observatory data — 3,059 indicators across 194 member states with country, region, year, and sex filters via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 4 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.3.4-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/who-gho-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/who-gho-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/who-gho-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/who-gho-mcp-server/releases/latest/download/who-gho-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=who-gho-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvd2hvLWdoby1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22who-gho-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fwho-gho-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

**Public Hosted Server:** [https://who-gho.caseyjhand.com/mcp](https://who-gho.caseyjhand.com/mcp)

</div>

---

## Overview

WHO Global Health Observatory (GHO) data — 3,059 indicators across 194 member states. Search the indicator catalog, discover country, region, income-group, and sex filter dimensions, and query data rows from any MCP client. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `who_search_indicators` | Search the GHO indicator catalog by keyword in indicator names |
| `who_list_indicators` | Browse the full indicator catalog with pagination |
| `who_get_indicator_metadata` | Fetch indicator names and supported filter dimensions for up to 10 codes |
| `who_list_dimensions` | List all dimension type codes available in the GHO API |
| `who_list_dimension_values` | List valid codes and labels for a dimension type (COUNTRY, REGION, SEX, etc.) |
| `who_query_indicator_data` | Query data rows for an indicator with spatial, temporal, and dimension filters |

### Resources

| Resource | Description |
|:---|:---|
| `who://indicator/{indicatorCode}/metadata` | Indicator name and supported filter dimensions for a single code |
| `who://dimension/{dimensionCode}/values` | First 100 values for a dimension type |
| `who://dimension/{dimensionCode}/values{?limit,offset}` | One explicit page of a dimension type's values |
| `who://dimension/{dimensionCode}/values{?limit,offset,parentCode}` | One explicit page, narrowed to a parent code |

Both resources mirror data also reachable via `who_get_indicator_metadata` and `who_list_dimension_values` — useful for clients that inject resources as context but don't call tools.

## Capability reference

### `who_search_indicators` <sub>tool</sub>

- Substring match on indicator names — try terms like `"life expectancy"`, `"immunization"`, `"mortality"`, `"diabetes"`, or `"HIV"`
- Returns indicator codes and display names for use with `who_query_indicator_data`
- Offset-based pagination (`offset`, default 0) with `limit` default 20, max 100; reports `totalCount`, `hasMore`, `pageInfo`, `nextOffset`
- An offset at or beyond `totalCount` returns an empty page; a `no_results` error is raised only when nothing matches at all

---

### `who_list_indicators` <sub>tool</sub>

- No keyword required — lists all 3,059+ catalog indicators
- Offset-based pagination via `limit` (default 50, max 500) and `offset`
- Returns `totalCount` and `hasMore` for iteration

---

### `who_get_indicator_metadata` <sub>tool</sub>

- Accepts 1–10 indicator codes per call, fetched in parallel
- Returns the full indicator name and supported dimension types (e.g. `COUNTRY`, `SEX`, `REGION`, `AGEGROUP`) for each resolved code
- Roughly 1,300 catalog indicators have no dimension listing upstream — those return `dimensions: []` plus a `dimensionsNote` pointing at a sample data row's `dim1Type`/`dim2Type`, not a not-found
- Codes absent from the catalog land in `notFound` rather than raising an error; the call fails only when none of the requested codes resolve

---

### `who_list_dimensions` <sub>tool</sub>

- No inputs — returns every dimension type code and human-readable title in the GHO catalog
- Common types: `COUNTRY`, `REGION`, `SEX`, `WORLDBANKINCOMEGROUP`, `AGEGROUP`
- Use to discover codes before calling `who_list_dimension_values`

---

### `who_list_dimension_values` <sub>tool</sub>

- Returns codes and labels for the dimension's values (e.g. the 234 country entries, the 43 WHO region codes), plus optional parent-hierarchy fields (`parentCode`, `parentLabel`, `parentDimension`)
- `parent_code` narrows hierarchical dimensions — `dimension: "COUNTRY"` with `parent_code: "EUR"` returns the 58 countries in the WHO European Region
- Deterministic ordering by `Code`; offset-based pagination (`offset`) with `limit` default 100, max 500 — `GHO` (3,103 values) and `DHSMICSGEOREGION` (4,932) need paging
- A `parent_code` that matches nothing returns an empty page, not an error; only an unfiltered empty result means the dimension itself does not exist
- An unpaired UTF-16 surrogate in `dimension` fails as a typed `malformed_identifier` validation error

---

### `who_query_indicator_data` <sub>tool</sub>

- Spatial filters are mutually exclusive per call: `country_codes` (ISO 3166-1 alpha-3), `region_codes` (WHO regions), or `income_group_codes` (World Bank groups) — supplying more than one is a validation error
- `year_from` / `year_to` time range; `sex` (`SEX_BTSX`, `SEX_FMLE`, `SEX_MLE`) applies only when the indicator's first cross-cutting dimension is SEX, otherwise use `dim1_value`
- `include_uncertainty` (default true) adds `low`/`high` bounds; `sort` (`year_desc` default or `year_asc`) with a total row ordering so paging never repeats or drops rows
- Offset-based pagination with `limit` default 200, max 1000; reports `totalRows`, `hasMore`, `pageInfo`, `nextOffset`
- Typed failure reasons: `indicator_not_found`, `no_data`, `ambiguous_spatial_filter`, `invalid_year_range`, `invalid_query`, `malformed_identifier`

---

### `who://indicator/{indicatorCode}/metadata` <sub>resource</sub>

- Indicator name and supported filter dimensions as `application/json`
- `indicatorCode` comes from `who_search_indicators` or `who_list_indicators`
- Empty `dimensions` carries a `dimensionsNote` when the upstream dimension table lists none for the code, rather than reporting a missing indicator
- Returns a 404 error only when the code resolves to neither a catalog name nor any dimension rows

---

### `who://dimension/{dimensionCode}/values` <sub>resource</sub>

- Bare URI returns the first 100 values for the dimension (`dimensionCode` from `who_list_dimensions`), as `application/json`
- Registered separately from the two paged variants below because the MCP SDK's RFC 6570 matcher treats every URI query variable as required — one template cannot serve both a bare and a paged form
- An unfiltered empty result means the dimension code does not exist

---

### `who://dimension/{dimensionCode}/values{?limit,offset}` <sub>resource</sub>

- `limit` (1–500) and `offset` must both be present in the URI — the query variables are required, not optional
- Same page fields as the bare URI: `totalCount`, `hasMore`, `nextOffset`, and an optional `notice`
- An offset at or beyond `totalCount` returns an empty page, not an error

---

### `who://dimension/{dimensionCode}/values{?limit,offset,parentCode}` <sub>resource</sub>

- Adds `parentCode` to narrow to one parent value, e.g. `parentCode="EUR"` for countries in the WHO European Region; `limit`, `offset`, and `parentCode` must all be present in the URI
- A `parentCode` that matches nothing returns an empty page, not an error — read the unfiltered URI to confirm the dimension itself exists
- Same output shape as the bare and paged resources: `dimension`, `values`, `totalCount`, `hasMore`, `nextOffset`, `notice`

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

WHO GHO-specific:

- Full coverage of the [WHO GHO OData API v2](https://www.who.int/data/gho/info/gho-odata-api) — indicators, dimensions, dimension values, and data queries
- Configurable base URL and request timeout (`GHO_BASE_URL`, `GHO_REQUEST_TIMEOUT_MS`) for custom or mirrored deployments
- Parallel metadata fan-out for multi-code indicator lookups
- Deterministic, total row/value ordering — pagination never repeats or drops rows across pages

Agent-friendly output:

- Tool descriptions encode the cross-tool workflow — agents discover the right call order (search → metadata → query) from descriptions alone
- Structured pagination signaling (`hasMore`, `nextOffset`, `pageInfo`, and `truncated` on the data-query tool) so agents can decide whether to page further
- Discriminated, typed error reasons with a `recovery` hint on every failure path
- Distinct empty-page vs. not-found semantics — paging past the end, an unmatched filter, and a genuinely missing code each report differently instead of colliding into one generic empty result

## Getting started

### Public Hosted Instance

A public instance is available at `https://who-gho.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "who-gho-mcp-server": {
      "type": "streamable-http",
      "url": "https://who-gho.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "who-gho-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/who-gho-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "who-gho-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/who-gho-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "who-gho-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/who-gho-mcp-server:latest"]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js ≥24).
- No API key required — the WHO GHO API is public.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/who-gho-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd who-gho-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set optional overrides
```

## Configuration

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted | `/mcp` |
| `MCP_SESSION_MODE` | HTTP session posture: `stateless`, `stateful`, or `auto`. No tool asks the caller for input mid-handler, so the server declares `stateless`; set this only to override. | `stateless` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if RSS grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `GHO_BASE_URL` | WHO GHO OData API base URL (override for custom/mirrored deployments) | `https://ghoapi.azureedge.net/api/` |
| `GHO_REQUEST_TIMEOUT_MS` | HTTP request timeout in milliseconds | `30000` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run the production version**:

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:http
  # or
  bun run start:stdio
  ```

- **Run checks and tests**:
  ```sh
  bun run devcheck  # Lints, formats, type-checks, and more
  bun run test      # Runs the test suite
  ```

### Docker

```sh
docker build -t who-gho-mcp-server .
docker run --rm -p 3010:3010 who-gho-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/who-gho-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools/resources and inits the GHO service. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Six tools across indicator discovery, dimension lookup, and data queries. |
| `src/mcp-server/resources` | Resource definitions. Indicator metadata and dimension values resources. |
| `src/services/gho` | WHO GHO OData API service layer — HTTP client, query builder, types. |
| `src/utils` | `wellFormed()` — repairs unpaired UTF-16 surrogates in caller-supplied strings before they reach output, enrichment, or failure data. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](./LICENSE) for details.
