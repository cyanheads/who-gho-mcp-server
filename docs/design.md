# WHO GHO MCP Server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `who_search_indicators` | Search the 3,059-indicator catalog by keyword in indicator name. Returns indicator codes and names for use with query tools. | `query` (keyword), `limit` | `readOnlyHint: true` |
| `who_list_indicators` | List indicators with optional pagination. Use for browsing when you don't have a keyword, or to page through the full catalog. | `limit`, `offset` | `readOnlyHint: true` |
| `who_get_indicator_metadata` | Get metadata for one or more indicator codes: full name and the dimensions it supports (COUNTRY, REGION, SEX, YEAR, WORLDBANKINCOMEGROUP, etc.). Call this before querying data to understand which filter dimensions are valid. | `indicator_codes` (array, up to 10) | `readOnlyHint: true` |
| `who_query_indicator_data` | Query data for a single indicator with filters: countries, regions, years, sex, income group. Returns rows with numeric values, uncertainty intervals, and spatial/time metadata. The primary data-fetching tool. | `indicator_code`, `country_codes`, `region_codes`, `income_group_codes`, `year_from`, `year_to`, `sex`, `dim1_value`, `limit` | `readOnlyHint: true` |
| `who_list_dimension_values` | List valid codes and labels for a dimension type (COUNTRY, REGION, SEX, WORLDBANKINCOMEGROUP, AGEGROUP, etc.). Use to discover valid filter values before calling `who_query_indicator_data`. | `dimension` | `readOnlyHint: true` |
| `who_list_dimensions` | List all dimension type codes and titles available in the GHO API. Use to discover valid dimension codes for `who_list_dimension_values`. | _(none)_ | `readOnlyHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `who://indicator/{indicatorCode}/metadata` | Metadata for a single indicator: full name and supported dimensions. | No |
| `who://dimension/{dimensionCode}/values` | All valid values for a dimension type. | No |

**Tool coverage note:** `who_list_dimensions` covers the dimension type catalog. `who_list_dimension_values` covers per-dimension values. Both data surfaces are reachable via tools — resources are supplementary.

### Prompts

None. This server is purely data-oriented — no recurring interaction patterns warrant a prompt template.

---

## Overview

Read-only MCP server exposing the WHO Global Health Observatory (GHO) API. Gives agents structured access to 3,059 global health indicators covering 194 WHO member states: life expectancy, disease prevalence, immunization coverage, nutrition, mortality, health systems capacity, and SDG health targets.

Primary use case is the find-then-query workflow: search/browse indicators → get metadata to understand available dimensions → query data with country/year/sex filters. Complements CDC (US-only) by providing the global view.

---

## Requirements

- Read-only. No authentication required.
- Covers the GHO OData API at `https://ghoapi.azureedge.net/api/`
- 3,059 indicators; discovery (keyword search + browsing) is essential
- Data rows have: `SpatialDim` (country/region code), `TimeDim` (year), `Dim1`/`Dim2`/`Dim3` (dimensions like SEX, AGEGROUP), `NumericValue`, `Low`/`High` (uncertainty interval), `Value` (formatted string), `Comments`
- Key spatial filter types: `COUNTRY` (ISO 3166-1 alpha-3), `REGION` (WHO regions: AFR, AMR, EMR, EUR, SEAR, WPR), `WORLDBANKINCOMEGROUP` (WB_HI, WB_LMI, WB_LI, WB_UMI, WB_MI), `GLOBAL`
- Key cross-dimension: SEX (SEX_BTSX, SEX_FMLE, SEX_MLE), AGEGROUP, WORLDBANKINCOMEGROUP
- OData $filter supports: `eq`, `in()`, `contains()`, `and`, `or`, `ge`, `le`, `gt`, `lt`
- OData $select, $orderby, $top, $skip, $count all work
- Invalid indicator code → HTTP 404 (empty body). Invalid filter value → HTTP 200 with empty `value` array. Invalid dimension code in `/DIMENSION/{code}/DimensionValues` → HTTP 200 with empty `value` array (not a 404).
- Unknown indicator code in `/IndicatorDimension?$filter=IndicatorCode eq '...'` → HTTP 200 with empty `value` array (not a 404). Distinguishing "unknown code" from "known code with no metadata" requires checking for empty `value` after a 200.
- `UNREGION` and `UNSDGREGION` are additional `SpatialDimType` values present in real data rows (e.g., numeric UN region codes like `"513"` for `UNREGION`). These are not filterable via the spatial filter parameters — they appear in unfiltered results.
- SEX is consistently `Dim1Type` when it appears. AGEGROUP and other cross-cutting types appear as `Dim2Type` when a row has both SEX and a second dimension. The `dim1_value` escape hatch only handles `Dim1` — there is no `dim2_value` parameter in the current design; filtering on AGEGROUP requires calling `who_get_indicator_metadata` to confirm dimension positions.
- No official rate limit documented. Public API, generous limits observed in practice.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `GhoService` | GHO OData API (`ghoapi.azureedge.net/api/`) | All tools and resources |

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `GHO_BASE_URL` | No | Override the GHO API base URL. Defaults to `https://ghoapi.azureedge.net/api/`. |
| `GHO_REQUEST_TIMEOUT_MS` | No | Request timeout in milliseconds. Default `30000`. |

No API key needed. No auth config needed.

---

## Implementation Order

1. Config (`src/config/server-config.ts`) — base URL + timeout
2. `GhoService` — OData fetch helpers, shared URL builder, retry/timeout wiring
3. `who_list_dimensions` — simplest, pure GET on `/DIMENSION`
4. `who_list_dimension_values` — GET on `/DIMENSION/{code}/DimensionValues`
5. `who_search_indicators` / `who_list_indicators` — GET on `/Indicator` with OData filter/skip
6. `who_get_indicator_metadata` — batch IndicatorDimension lookup
7. `who_query_indicator_data` — the main data tool, builds OData $filter from inputs
8. Resources (`who://indicator/…` and `who://dimension/…`)

Each step is independently testable against the live API.

---

## Domain Mapping

The GHO OData API has a clear three-layer model:

| Layer | Endpoint | Notes |
|:------|:---------|:------|
| **Indicator catalog** | `GET /Indicator` | 3,059 rows; fields: `IndicatorCode`, `IndicatorName`, `Language`. Supports `$filter=contains(IndicatorName,'...')`, `$top`, `$skip`, `$count`. |
| **Dimension catalog** | `GET /DIMENSION` | List of all dimension type codes and titles (`Code`, `Title`). No nav property on this endpoint — use the separate DimensionValues endpoint. |
| **Dimension values** | `GET /DIMENSION/{code}/DimensionValues` | Valid values for one dimension type. Fields: `Code`, `Title`, `ParentDimension`, `Dimension`, `ParentCode`, `ParentTitle`. Invalid dimension code returns HTTP 200 with empty `value` array. |
| **Indicator data** | `GET /{IndicatorCode}` | Each indicator is its own OData entity set. Full row schema: see below. Supports all OData query options. |
| **Indicator → Dimensions** | `GET /IndicatorDimension?$filter=IndicatorCode eq '...'` | Which dimensions a given indicator actually uses (e.g., WHOSIS_000001 uses COUNTRY, REGION, YEAR, SEX, WORLDBANKINCOMEGROUP, PUBLISHSTATE). Returns HTTP 200 with empty `value` array for unknown codes — not a 404. Fields: `IndicatorCode`, `Language`, `Dimension`, `DimensionName`. |

**Data row schema** (all indicators share this structure):

| Field | Type | Notes |
|:------|:-----|:------|
| `Id` | int | Row ID |
| `IndicatorCode` | string | e.g. `WHOSIS_000001` |
| `SpatialDimType` | string | `COUNTRY`, `REGION`, `WORLDBANKINCOMEGROUP`, `GLOBAL`, `UNREGION`, `UNSDGREGION`, etc. |
| `SpatialDim` | string | e.g. `JPN`, `AFR`, `WB_HI`, `"30"` (numeric string for UNREGION) |
| `TimeDimType` | string | `YEAR` |
| `TimeDim` | int | e.g. `2021` |
| `ParentLocationCode` | string? | WHO region code when `SpatialDimType=COUNTRY` |
| `ParentLocation` | string? | WHO region name |
| `Dim1Type` / `Dim1` | string? | First cross-cutting dimension type + value. SEX is consistently `Dim1Type` when present (e.g. `SEX` / `SEX_BTSX`). |
| `Dim2Type` / `Dim2` | string? | Second cross-cutting dimension. AGEGROUP appears here when the indicator also uses SEX as Dim1. Other types (ENVCAUSE, etc.) also appear as Dim2. |
| `Dim3Type` / `Dim3` | string? | Third cross-cutting dimension (rare) |
| `NumericValue` | decimal? | Machine-readable value |
| `Low` / `High` | decimal? | Uncertainty interval bounds |
| `Value` | string? | Formatted display value, e.g. `"84.5 [84.5-84.5]"` |
| `Comments` | string? | Data source notes |
| `Date` | datetime | Last updated timestamp |
| `TimeDimensionValue` | string | Year as string, e.g. `"2021"` (redundant with `TimeDim` but present in full response) |
| `TimeDimensionBegin` / `TimeDimensionEnd` | datetime | ISO 8601 year boundary datetimes (present in full response, not needed in $select) |

---

## Workflow Analysis

### Workflow: Find and compare life expectancy across countries

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `who_search_indicators` | `query: "life expectancy"` → returns `WHOSIS_000001`, `WHOSIS_000002`, etc. |
| 2 | `who_get_indicator_metadata` | `indicator_codes: ["WHOSIS_000001"]` → confirms SEX and COUNTRY dimensions valid |
| 3 | `who_query_indicator_data` | `indicator_code: "WHOSIS_000001"`, `country_codes: ["JPN","USA","BRA"]`, `year_from: 2020`, `sex: "SEX_BTSX"` |

### Workflow: Country health profile

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `who_list_dimension_values` | `dimension: "COUNTRY"` → confirms ISO code for target country |
| 2 | Multiple `who_query_indicator_data` calls | Different indicators for same country/year range |

### Workflow: Regional comparison (income group)

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `who_list_dimension_values` | `dimension: "WORLDBANKINCOMEGROUP"` → get WB_HI, WB_LMI, etc. codes |
| 2 | `who_query_indicator_data` | Filter by `income_group_codes` (passes `SpatialDimType eq 'WORLDBANKINCOMEGROUP'` + `SpatialDim in (...)`) |

### `who_query_indicator_data` — upstream call breakdown

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `GET /{indicatorCode}?$filter=...&$select=...&$orderby=...&$top=...` | Fetch data rows filtered by country/region/year/sex/income group |

The tool builds one OData request. No multi-step orchestration needed — OData's $filter handles all the composition. The `SpatialDimType` filter is the key lever: pass `COUNTRY` + `SpatialDim in ('JPN','USA')` for specific countries; pass `WORLDBANKINCOMEGROUP` + `SpatialDim in ('WB_HI')` for income groups; omit spatial filters to get all geographies (may be large).

---

## Tool Schemas (detail)

### `who_search_indicators`

```
input:
  query: string — keyword to search in indicator names
  limit: number (default 20, max 100) — max results to return
output:
  indicators: Array<{ indicatorCode: string, indicatorName: string }>
  totalMatches: number — total count matching the query (for paging awareness)
  note: string? — if limit was reached, hint to refine query or paginate
errors:
  - no_results: NotFound — when query matches nothing
annotations: readOnlyHint: true, openWorldHint: false
```

### `who_list_indicators`

```
input:
  limit: number (default 50, max 500)
  offset: number (default 0)
output:
  indicators: Array<{ indicatorCode: string, indicatorName: string }>
  total: number
  hasMore: boolean
annotations: readOnlyHint: true, openWorldHint: false
```

### `who_get_indicator_metadata`

```
input:
  indicator_codes: string[] (max 10) — e.g. ["WHOSIS_000001"]
output:
  indicators: Array<{
    indicatorCode: string,
    indicatorName: string,
    dimensions: Array<{ dimension: string, dimensionName: string }>
    — dimension maps to IndicatorDimension.Dimension (e.g. "COUNTRY", "SEX")
    — dimensionName maps to IndicatorDimension.DimensionName (e.g. "Country", "Sex")
  }>
  notFound: string[] — codes that returned empty metadata (API returns 200 + empty value array for unknown codes)
errors:
  - all_not_found: NotFound — when all requested codes return empty metadata
annotations: readOnlyHint: true, openWorldHint: false
```

Implemented with `Promise.all` — one `/IndicatorDimension?$filter=IndicatorCode eq '...'` call per code, fanned out in parallel. The API always returns HTTP 200 for this endpoint (even for unknown codes); codes with an empty `value` array go into `notFound`. Note: results may include `PUBLISHSTATE` as a dimension — this is an internal publishing status dimension, not a user-filterable dimension. Filter it from the output before returning to callers.

### `who_query_indicator_data`

```
input:
  indicator_code: string — e.g. "WHOSIS_000001"
  country_codes: string[]? — ISO 3-letter codes e.g. ["JPN","USA"]
  region_codes: string[]? — WHO region codes e.g. ["AFR","EUR"]
  income_group_codes: string[]? — World Bank codes e.g. ["WB_HI","WB_LMI"]
  year_from: number? — start year inclusive
  year_to: number? — end year inclusive
  sex: enum? — "SEX_BTSX" | "SEX_FMLE" | "SEX_MLE"
  dim1_value: string? — arbitrary Dim1 filter for indicators with non-SEX Dim1 (e.g. AGEGROUP code)
  include_uncertainty: boolean (default true) — whether to include Low/High bounds in output
  limit: number (default 200, max 1000)
output:
  rows: Array<{
    indicatorCode: string,
    spatialDimType: string,
    spatialDim: string,
    spatialLabel: string?,   -- ParentLocation for countries
    year: number,
    dim1Type: string?,
    dim1: string?,
    dim2Type: string?,   -- Dim2 type when present (e.g. AGEGROUP, ENVCAUSE)
    dim2: string?,       -- Dim2 value when present
    numericValue: number?,
    low: number?,
    high: number?,
    displayValue: string?,
    comments: string?
  }>
  totalRows: number  -- $count from OData
  truncated: boolean  -- true if totalRows > limit
  truncatedNote: string?  -- how to retrieve more if truncated
errors:
  - indicator_not_found: NotFound — 404 on /{indicatorCode}
  - no_data: NotFound — valid indicator, empty result for given filters
  - ambiguous_spatial_filter: ValidationError — when more than one of country_codes, region_codes, income_group_codes are provided (SpatialDimType can only be one per request)
annotations: readOnlyHint: true, openWorldHint: false
```

**Spatial filter design note:** OData data rows are stamped with exactly one `SpatialDimType`. A filter combining `SpatialDimType eq 'COUNTRY' and SpatialDim in ('JPN')` works correctly (verified). If more than one of `country_codes`, `region_codes`, `income_group_codes` are provided, the tool errors with a clear message rather than silently dropping one spatial type. If only `country_codes` are provided, `SpatialDimType eq 'COUNTRY' and SpatialDim in (...)` is used. If only `region_codes`, `SpatialDimType eq 'REGION' and SpatialDim in (...)`. If only `income_group_codes`, `SpatialDimType eq 'WORLDBANKINCOMEGROUP' and SpatialDim in (...)`. If none are provided, no spatial filter is applied (returns all geographies including UNREGION, UNSDGREGION rows — can be large, capped by `limit`).

Note: filtering by `SpatialDim in (...)` without a `SpatialDimType` filter works at the API level and returns all rows matching those spatial dim codes regardless of type. This is not exposed as a parameter — always pair with `SpatialDimType` to avoid mixing heterogeneous geographies in one result set.

**Year filter:** `TimeDim ge {year_from} and TimeDim le {year_to}` appended when provided.

**Sex filter:** appended as `Dim1Type eq 'SEX' and Dim1 eq '{sex}'` — SEX is consistently the `Dim1Type` position when present (verified against real data), so this is safe to apply without a prior metadata call. If the indicator doesn't use SEX at all, the filter returns empty and the output `noDataNote` suggests checking dimension metadata.

### `who_list_dimension_values`

```
input:
  dimension: string — dimension code, e.g. "COUNTRY", "REGION", "SEX", "WORLDBANKINCOMEGROUP", "AGEGROUP"
    .describe: 'Dimension type code. Use who_list_dimensions to discover all available codes. Common values: COUNTRY, REGION, SEX, WORLDBANKINCOMEGROUP, AGEGROUP.'
output:
  values: Array<{
    code: string,       — maps to DimensionValue.Code
    label: string,      — maps to DimensionValue.Title
    parentCode?: string,      — maps to DimensionValue.ParentCode (e.g. WHO region code for a country)
    parentLabel?: string,     — maps to DimensionValue.ParentTitle
    parentDimension?: string  — maps to DimensionValue.ParentDimension (e.g. "REGION" for country entries)
  }>
  dimension: string
  dimensionTitle: string  — not returned by API; derive from who_list_dimensions or omit
errors:
  - dimension_not_found: NotFound — when API returns empty value array (the API returns HTTP 200 for unknown dimensions, not 404; treat empty response as not-found)
annotations: readOnlyHint: true, openWorldHint: false
```

**Implementation note:** The API returns HTTP 200 with an empty `value` array for unknown dimension codes. The tool must check for empty `value` and raise `NotFound` rather than detecting by HTTP status. `dimensionTitle` is not part of the DimensionValues response — populate from a prior call to `GET /DIMENSION` or omit the field.

### `who_list_dimensions`

```
input:
  (none)
output:
  dimensions: Array<{ code: string, title: string }>
    — maps to GET /DIMENSION response: Code → code, Title → title
errors:
  (none expected — stable catalog endpoint)
annotations: readOnlyHint: true, openWorldHint: false
```

Returns the full list of dimension type codes and human-readable titles (e.g. `{ code: "AGEGROUP", title: "Age Group" }`). Use when callers need to discover what dimension codes exist before calling `who_list_dimension_values`. There are many dimension types beyond the common ones — this endpoint exposes all of them.

---

## API Reference

### Base URL

```
https://ghoapi.azureedge.net/api/
```

### Key endpoints

| Endpoint | Purpose |
|:---------|:--------|
| `GET /Indicator` | Indicator catalog |
| `GET /DIMENSION` | All dimension type codes and titles |
| `GET /DIMENSION/{code}/DimensionValues` | Valid values for one dimension type |
| `GET /IndicatorDimension` | Cross-reference: which dimensions an indicator uses |
| `GET /{IndicatorCode}` | Data rows for one indicator |

### OData query parameters

| Parameter | Supported | Notes |
|:----------|:----------|:------|
| `$filter` | Yes | `eq`, `ne`, `in()`, `contains()`, `and`, `or`, `ge`, `le`, `gt`, `lt` |
| `$select` | Yes | Reduces payload significantly for large result sets |
| `$orderby` | Yes | e.g. `NumericValue desc` |
| `$top` | Yes | Page size cap |
| `$skip` | Yes | Offset-based paging |
| `$count=true` | Yes | Returns `@odata.count` in response alongside `value` |
| `$format=json` | Not needed | Responses are JSON by default |

### Spatial dimension types in data

| SpatialDimType | Example values | When to use |
|:---------------|:---------------|:------------|
| `COUNTRY` | `JPN`, `USA`, `BRA` (ISO 3166-1 alpha-3) | Country-level data |
| `REGION` | `AFR`, `AMR`, `EMR`, `EUR`, `SEAR`, `WPR` | WHO regional aggregates |
| `WORLDBANKINCOMEGROUP` | `WB_HI`, `WB_LMI`, `WB_LI`, `WB_UMI`, `WB_MI` | Income-group aggregates |
| `GLOBAL` | `GLOBAL` | Global aggregate |
| `UNREGION` | Numeric strings like `"30"`, `"513"` | UN regional aggregates — appear in unfiltered results, not filterable via tool params |
| `UNSDGREGION` | e.g. `"UNSDG_SUBSAHARANAFRICA"` | UN SDG regional aggregates — appear in unfiltered results, not filterable via tool params |

### Error behavior

- `GET /{UnknownIndicatorCode}` → HTTP 404, empty body
- `GET /{IndicatorCode}?$filter=SpatialDim eq 'INVALID'` → HTTP 200, `{ "value": [] }`
- `GET /DIMENSION/UNKNOWNCODE/DimensionValues` → HTTP 200, `{ "value": [] }` (not a 404)
- `GET /IndicatorDimension?$filter=IndicatorCode eq 'UNKNOWNCODE'` → HTTP 200, `{ "value": [] }` (not a 404)
- `$skip` beyond end of indicator list → HTTP 200, `{ "value": [] }`

---

## Design Decisions

**1. No convenience "query by name" shortcut tool.** The initial idea was a `who_get_indicator` that accepts a plain English description and finds-then-fetches in one call. Deferred: without semantic search the name matching would be brittle (`contains()` on IndicatorName), and the two-step workflow (`who_search_indicators` → `who_query_indicator_data`) is only marginally longer while giving the agent explicit confirmation of which indicator code it's using. Add a shortcut if user feedback shows friction.

**2. Six tools, not three.** Could collapse list/search/metadata into a single tool with a `mode` enum. Kept them separate because the operations have distinct preconditions, input shapes, and output schemas — collapsing would force awkward optional output fields and a longer description. `who_list_dimensions` is a trivial GET on `/DIMENSION` that returns available dimension type codes; without it, callers must already know valid dimension codes to pass to `who_list_dimension_values`, making dimension discovery a dead end.

**3. Spatial filter is mutually exclusive per call.** OData data rows are stamped with exactly one `SpatialDimType`. A query mixing `COUNTRY` and `WORLDBANKINCOMEGROUP` would require two requests. The tool errors explicitly rather than silently splitting into two calls — agents should know what they're getting, not receive silently merged results from two query paths.

**4. No DataCanvas.** Considered for cross-indicator SQL queries. Deferred: the primary workflows are single-indicator filtered queries, not cross-indicator joins. Adding DuckDB as a dependency for a read-only research server feels disproportionate. Revisit if multi-indicator comparison becomes a core use case.

**5. Resources are supplementary.** `who://indicator/{code}/metadata` and `who://dimension/{code}/values` cover the same data as two of the tools. Kept them because the data is stable (indicator metadata rarely changes), addressable by URI, and useful as injectable context. Tool coverage is primary.

**6. Dim1 filter is applied optimistically.** The tool can't cheaply know whether an indicator uses SEX as Dim1 without a separate `/IndicatorDimension` call. Rather than forcing a two-step flow, the sex filter is applied as an OData `Dim1Type eq 'SEX' and Dim1 eq '...'` predicate. If the indicator doesn't use SEX as Dim1, the filter returns empty and the `truncatedNote` explains how to diagnose. Agents that call `who_get_indicator_metadata` first avoid this edge case entirely.

**7. `dim1_value` escape hatch — no `dim2_value`.** Real data shows AGEGROUP appears as `Dim2Type` when SEX is already `Dim1Type`. A `dim1_value` parameter handles the case where a non-SEX type occupies Dim1, but AGEGROUP filtering via Dim2 is intentionally left out of scope — filtering on `Dim2` requires knowing the indicator's Dim2 position from metadata first, and the multi-dim case is complex enough that callers should use `who_get_indicator_metadata` first and then apply no sex filter, relying on `limit` to cap results.

**8. PUBLISHSTATE filtered from metadata output.** The `/IndicatorDimension` endpoint returns `PUBLISHSTATE` as a dimension for many indicators. This is an internal publishing workflow dimension, not a data dimension callers can filter on in `who_query_indicator_data`. Strip it from `who_get_indicator_metadata` output to avoid confusing callers.

---

## Known Limitations

- **No indicator theme/category navigation.** The `DIMENSION/GHO/DimensionValues` endpoint exists and returns all ~3,059 indicators as a flat list with `Code` and `Title` fields — but no `ParentCode`/`ParentTitle` hierarchy (all parent fields are null). Themes exist in the GHO web UI but the hierarchy is not exposed in this OData API. Keyword search via `who_search_indicators` is the only practical discovery path.
- **Indicator codes are opaque.** Codes like `WHOSIS_000001` or `NCD_CCS_DiabetesTest` don't self-describe their domain. Agents must search by name.
- **Cross-spatial queries require multiple calls.** Comparing a specific country to its WHO region aggregate requires two separate `who_query_indicator_data` calls.
- **Subnational data absent.** Only country-level and aggregate (region/income group/global) data is in scope. Subnational breakdowns are not available in the OData API.
- **Data currency varies by indicator.** Some indicators are updated annually; others lag by years. The `Date` field on each row indicates last update, but there's no API-level field for "data vintage" at the indicator level.
- **Empty body on 404.** When `GET /{IndicatorCode}` returns 404, the response body is empty. The service layer must detect the HTTP status rather than trying to parse a structured error.

---

## Decisions Log

| Date | Decision | Rationale |
|:-----|:---------|:----------|
| 2026-05-23 | Six tools: search, list, metadata, query data, list dimension values, list dimensions | Goal-first: the primary workflows are discover → confirm dimensions → query. Added who_list_dimensions because who_list_dimension_values requires knowing valid dimension codes — without a discovery path, dimension browsing is a dead end. |
| 2026-05-23 | Spatial filter is mutually exclusive (COUNTRY vs REGION vs WORLDBANKINCOMEGROUP) | The OData data model stamps each row with one SpatialDimType. Silently splitting into two calls and merging would produce surprising output. Explicit error with guidance is safer. |
| 2026-05-23 | No DataCanvas | Single-indicator filtered queries are the 95% case. Multi-indicator SQL joins are a future need, not a current one. |
| 2026-05-23 | No semantic/convenience "query by natural language name" shortcut | `contains()` keyword matching is already exposed via `who_search_indicators`. An opaque shortcut that hides indicator code selection removes agent visibility into which indicator is being queried — bad for research workflows that need citation precision. |
| 2026-05-23 | No auth config | GHO API is public, no API key required. No `server-config.ts` fields needed beyond base URL override and request timeout. |
| 2026-05-23 | Resources added for indicator metadata and dimension values | Both are stable, URI-addressable, and useful as injectable context. Tools are primary; resources are convenience for clients that support them. |
