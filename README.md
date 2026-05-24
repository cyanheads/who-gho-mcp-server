<div align="center">
  <h1>@cyanheads/who-gho-mcp-server</h1>
  <p><b>Query WHO Global Health Observatory data — 3,059 indicators across 194 member states with country, region, year, and sex filters via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.6-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/who-gho-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/who-gho-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/who-gho-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/who-gho-mcp-server/releases/latest/download/who-gho-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=who-gho-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvd2hvLWdoby1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22who-gho-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fwho-gho-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

**Public Hosted Server:** [https://who-gho.caseyjhand.com/mcp](https://who-gho.caseyjhand.com/mcp)

</div>

---

## Tools

6 tools for working with WHO Global Health Observatory data:

| Tool | Description |
|:---|:---|
| `who_search_indicators` | Search the GHO indicator catalog by keyword in indicator names |
| `who_list_indicators` | Browse the full indicator catalog with pagination |
| `who_get_indicator_metadata` | Fetch indicator names and supported filter dimensions for up to 10 codes |
| `who_list_dimensions` | List all dimension type codes available in the GHO API |
| `who_list_dimension_values` | List valid codes and labels for a dimension type (COUNTRY, REGION, SEX, etc.) |
| `who_query_indicator_data` | Query data rows for an indicator with spatial, temporal, and dimension filters |

### `who_search_indicators`

Search the WHO GHO indicator catalog by keyword.

- Substring match on indicator names — try terms like `"life expectancy"`, `"immunization"`, `"mortality"`, `"diabetes"`, or `"HIV"`
- Returns indicator codes and display names for use with `who_query_indicator_data`
- Reports total matches; suggests narrowing when the limit is reached
- Default limit 20, max 100

---

### `who_list_indicators`

Browse the full indicator catalog with offset-based pagination.

- No keyword required — lists all 3,059+ indicators
- Pagination via `limit` (default 50, max 500) and `offset`
- Returns `total` and `hasMore` for iteration

---

### `who_get_indicator_metadata`

Fetch metadata for one to ten indicator codes in a single call.

- Returns the full indicator name and the dimension types it supports (e.g. `COUNTRY`, `SEX`, `REGION`, `AGEGROUP`)
- Call before `who_query_indicator_data` to confirm which filter dimensions are valid
- Unresolved codes are reported in `notFound` rather than raising an error

---

### `who_list_dimensions`

List all dimension type codes available in the GHO API.

- Returns every dimension type with its human-readable title
- Common types: `COUNTRY`, `REGION`, `SEX`, `WORLDBANKINCOMEGROUP`, `AGEGROUP`
- Use to discover codes before calling `who_list_dimension_values`

---

### `who_list_dimension_values`

List valid filter values for a single dimension type.

- Returns codes and labels for every value under the dimension (e.g. all 194 country ISO codes, all WHO region codes)
- Includes optional parent hierarchy fields (`parentCode`, `parentLabel`, `parentDimension`)
- Use to confirm exact codes before passing them to `who_query_indicator_data`

---

### `who_query_indicator_data`

Query data rows for a single WHO GHO indicator.

- Spatial filters (mutually exclusive): `country_codes` (ISO 3166-1 alpha-3), `region_codes` (WHO regions), or `income_group_codes` (World Bank groups)
- Time range filter: `year_from` / `year_to`
- Sex filter: `SEX_BTSX` (both), `SEX_FMLE`, `SEX_MLE` — only applies when the indicator uses SEX as its first cross-cutting dimension
- Arbitrary `dim1_value` for indicators using non-SEX cross-cutting dimensions
- Optional uncertainty interval bounds (`low`/`high`) via `include_uncertainty` (default true)
- Default limit 200, max 1000; returns `totalRows` and `truncated` for handling large result sets
- Primary data tool in the find-then-query workflow

## Resources

| Type | URI | Description |
|:---|:---|:---|
| Resource | `who://indicator/{indicatorCode}/metadata` | Indicator name and supported filter dimensions for a single code |
| Resource | `who://dimension/{dimensionCode}/values` | All valid values for a dimension type |

## Recommended workflow

1. `who_search_indicators` — find indicator codes by keyword
2. `who_get_indicator_metadata` — confirm which filter dimensions the indicator supports
3. `who_query_indicator_data` — fetch data with country/region/year/sex filters

To look up filter codes: `who_list_dimensions` → `who_list_dimension_values`.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling across all tools
- Pluggable auth (`none`, `jwt`, `oauth`)
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- Runs locally (stdio/HTTP) or on Cloudflare Workers from the same codebase

WHO GHO-specific:

- Full coverage of the [WHO GHO OData API v2](https://www.who.int/data/gho/info/gho-odata-api) — indicators, dimensions, dimension values, and data queries
- Configurable base URL and request timeout for custom or mirrored deployments
- Parallel metadata fan-out for multi-code indicator lookups

Agent-friendly output:

- Tool descriptions encode the cross-tool workflow — agents discover the right call order from descriptions alone
- Structured truncation signaling (`truncated`, `truncatedNote`, `hasMore`) so agents can decide whether to paginate
- Discriminated error codes with `recovery` hints on every failure path

## Getting started

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "who-gho": {
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
    "who-gho": {
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
    "who-gho": {
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

- [Bun v1.3.2](https://bun.sh/) or higher (or Node.js ≥24).
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

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if RSS grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `GHO_BASE_URL` | WHO GHO OData API base URL (override for custom/mirrored deployments) | `https://ghoapi.azureedge.net/api/` |
| `GHO_REQUEST_TIMEOUT_MS` | HTTP request timeout in milliseconds | `30000` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

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

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Six tools across indicator discovery, dimension lookup, and data queries. |
| `src/mcp-server/resources` | Resource definitions. Indicator metadata and dimension values resources. |
| `src/services/gho` | WHO GHO OData API service layer — HTTP client, query builder, types. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
