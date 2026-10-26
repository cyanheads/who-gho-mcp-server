# WHO GHO MCP Server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `who_search_indicators` | Search the 3,102-indicator catalog by independently matched words in indicator names, with exact-code fallback when names have no matches. | `query`, `limit`, `offset` | `readOnlyHint: true` |
| `who_list_indicators` | List indicators with optional pagination. Use for browsing when you don't have a keyword, or to page through the full catalog. | `limit`, `offset` | `readOnlyHint: true` |
| `who_get_indicator_metadata` | Resolve canonical names and dimension types; types do not identify positional slots. Process 10 entries per call with continuation. | `indicator_codes` | `readOnlyHint: true` |
| `who_query_indicator_data` | Query one indicator with spatial, temporal, sex, and positional dimension filters. Return observations with sparse coordinates and uncertainty bounds preserved. | `indicator_code`, spatial codes, years, `sex`, `dim1_value`, `dim2_value`, `dim3_value`, `limit`, `offset` | `readOnlyHint: true` |
| `who_list_dimension_values` | List valid codes and labels for a dimension type (COUNTRY, REGION, SEX, WORLDBANKINCOMEGROUP, AGEGROUP, etc.). Use to discover valid filter values before calling `who_query_indicator_data`. | `dimension` | `readOnlyHint: true` |
| `who_list_dimensions` | List all dimension type codes and titles available in the GHO API. Use to discover valid dimension codes for `who_list_dimension_values`. | _(none)_ | `readOnlyHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `who://indicator/{indicatorCode}/metadata` | Metadata for a single indicator: full name and supported dimensions. | No |
| `who://dimension/{dimensionCode}/values` | First 100 valid values for a dimension type. | First page |
| `who://dimension/{dimensionCode}/values{?limit,offset}` | An explicit dimension-values page. | Yes |
| `who://dimension/{dimensionCode}/values{?limit,offset,parentCode}` | A page narrowed to one parent. | Yes |
| `skill://{+path}` | Published calling-agent skill files. | No |

**Tool coverage note:** `who_list_dimensions` covers the dimension type catalog. `who_list_dimension_values` covers per-dimension values. Both data surfaces are reachable via tools — resources are supplementary.

### Published skill

`skills/who-gho-guide/SKILL.md` carries positional dimension discovery and completeness gates for country/aggregate comparisons. It is delivered through plugin installs, npm, Docker, and MCPB. `createApp({ skills: 'skills' })` also advertises `io.modelcontextprotocol/skills`, adds `skills/list`, `skills/get`, and `resources/directory/read`, lists the skill in `resources/list`, and registers `skill://{+path}`. This adds a skill resource without adding a tool or prompt.

### Prompts

None. This server is purely data-oriented — no recurring interaction patterns warrant a prompt template.

---

## Overview

Read-only MCP server exposing the WHO Global Health Observatory (GHO) API. Gives agents structured access to 3,102 global health indicators covering 194 WHO member states: life expectancy, disease prevalence, immunization coverage, nutrition, mortality, health systems capacity, and SDG health targets.

Primary use case is the find-then-query workflow: search/browse indicators → get metadata to understand available dimensions → query data with country/year/sex filters. Complements CDC (US-only) by providing the global view.

---

## Requirements

- Read-only. No authentication required.
- Covers the GHO OData API at `https://ghoapi.azureedge.net/api/`
- 3,102 indicators; discovery (keyword search + browsing) is essential
- Data rows have: `SpatialDim` (country/region code), `TimeDim` (year), `Dim1`/`Dim2`/`Dim3` (dimensions like SEX, AGEGROUP), `NumericValue`, `Low`/`High` (uncertainty interval), `Value` (formatted string), `Comments`
- Key spatial filter types: `COUNTRY` (WHO country codes, including historical entries), `REGION` (WHO regions: AFR, AMR, EMR, EUR, SEAR, WPR), `WORLDBANKINCOMEGROUP` (WB_HI, WB_LMI, WB_LI, WB_UMI, WB_MI), `GLOBAL`
- Key cross-dimension: SEX (SEX_BTSX, SEX_FMLE, SEX_MLE), AGEGROUP, WORLDBANKINCOMEGROUP
- OData $filter supports: `eq`, `in()`, `contains()`, `and`, `or`, `ge`, `le`, `gt`, `lt`
- OData $select, $orderby, $top, $skip, $count all work
- Invalid indicator code → HTTP 404 (empty body). Invalid filter value → HTTP 200 with empty `value` array. Invalid dimension code in `/DIMENSION/{code}/DimensionValues` → HTTP 200 with empty `value` array (not a 404).
- Unknown indicator code in `/IndicatorDimension?$filter=IndicatorCode eq '...'` → HTTP 200 with empty `value` array (not a 404). Resolve existence separately against the Indicator catalog; a valid catalog entry can have no dimension listing.
- `UNREGION` and `UNSDGREGION` are additional `SpatialDimType` values present in real data rows (e.g., numeric UN region codes like `"513"` for `UNREGION`). These are not filterable via the spatial filter parameters — they appear in unfiltered results.
- Metadata lists dimension types without positions. Inspect returned `dim1Type`/`dim1`, `dim2Type`/`dim2`, and `dim3Type`/`dim3` pairs before selecting positional filters. For example, `MORT_100` rows can carry SEX, AGEGROUP, and CHILDCAUSE in positions 1, 2, and 3. Missing coordinates remain absent.
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
| `GHO_REQUEST_TIMEOUT_MS` | No | Service-operation deadline covering attempts, body reads, retries, and backoff. Default `30000` milliseconds. |
| `GHO_CLAMP_LIMITS` | No | Default `true`: clamp oversized positive integer pages with notices and process metadata in 10-code batches with continuation. `false` restores advertised maxima and oversized-input rejection. |

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
| **Indicator catalog** | `GET /Indicator` | 3,102 rows; fields: `IndicatorCode`, `IndicatorName`, `Language`. Supports `$filter=contains(IndicatorName,'...')`, `$top`, `$skip`, `$count`. |
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
| 1 | `who_list_dimension_values` | `dimension: "COUNTRY"` → resolves the WHO code for the target country |
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
  query: string — words matched independently in indicator names, with exact-code fallback
  limit: number (default 20, max 100) — max results to return
  offset: number (default 0)
output:
  indicators: Array<{ indicatorCode: string, indicatorName: string }>
  totalCount: number — total count matching the selected name-search or exact-code result set
  hasMore: boolean
  nextOffset: number? — continuation offset
  notice: string? — limit, pagination, or past-end guidance
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
  totalCount: number
  hasMore: boolean
annotations: readOnlyHint: true, openWorldHint: false
```

### `who_get_indicator_metadata`

```
input:
  indicator_codes: string[] — up to 1,000 entries, first 10 processed; max 10 when clamping disabled
output:
  indicators: Array<{
    indicatorCode: string,
    indicatorName: string,
    dimensions: Array<{ dimension: string, dimensionName: string }>
    — dimension maps to IndicatorDimension.Dimension (e.g. "COUNTRY", "SEX")
    — dimensionName maps to IndicatorDimension.DimensionName (e.g. "Country", "Sex")
  }>
  notFound: string[] — processed codes resolving to neither a catalog entry nor dimension rows
  unprocessedCodes: string[]? — remaining request entries, in order, to submit next
errors:
  - all_not_found: NotFound — no processed code resolves and no continuation remains
annotations: readOnlyHint: true, openWorldHint: false
```

Catalog identity and dimension metadata are resolved separately. A catalog match supplies the canonical code and name, including when requested with different casing. A code with dimension rows alone retains its code as the fallback name. Only a code with neither signal enters `notFound`; an empty dimension listing on a valid code carries `dimensionsNote`. `PUBLISHSTATE` is excluded because it is not a caller-filterable data dimension.

### `who_query_indicator_data`

```
input:
  indicator_code: string — e.g. "WHOSIS_000001"
  country_codes: string[]? — WHO country codes e.g. ["JPN","USA"], including historical codes
  region_codes: string[]? — WHO region codes e.g. ["AFR","EUR"]
  income_group_codes: string[]? — World Bank codes e.g. ["WB_HI","WB_LMI"]
  year_from: number? — start year inclusive
  year_to: number? — end year inclusive
  sex: enum? — "SEX_BTSX" | "SEX_FMLE" | "SEX_MLE"
  dim1_value: string? — arbitrary Dim1 filter; sex takes precedence with a notice
  dim2_value: string? — value in the observed second dimension position
  dim3_value: string? — value in the observed third dimension position
  include_uncertainty: boolean (default true) — whether to include Low/High bounds in output
  limit: number (default 200, max 1000)
output:
  rows: Array<{
    indicatorCode: string,
    spatialDimType: string?,
    spatialDim: string?,
    parentLocation: string?,      -- ParentLocation: parent WHO region name, absent on region/aggregate rows
    parentLocationCode: string?,  -- ParentLocationCode: parent WHO region code, chainable to region_codes
    year: number?,
    dim1Type: string?,
    dim1: string?,
    dim2Type: string?,   -- Dim2 type when present (e.g. AGEGROUP, ENVCAUSE)
    dim2: string?,       -- Dim2 value when present
    dim3Type: string?,   -- Third dimension type when present
    dim3: string?,       -- Third dimension value when present
    numericValue: number?,
    low: number?,
    high: number?,
    displayValue: string?,
    comments: string?
  }>
  totalRows: number  -- $count from OData
  truncated: boolean?  -- true when rows remain after this page
  hasMore: boolean
  nextOffset: number?  -- continuation offset
  notice: string?  -- composed filter, limit, and pagination guidance
errors:
  - indicator_not_found: NotFound — 404 on /{indicatorCode}
  - no_data: NotFound — valid indicator, empty result for given filters
  - ambiguous_spatial_filter: ValidationError — when more than one of country_codes, region_codes, income_group_codes are provided (SpatialDimType can only be one per request)
annotations: readOnlyHint: true, openWorldHint: false
```

**Spatial filter design note:** OData data rows are stamped with exactly one `SpatialDimType`. A filter combining `SpatialDimType eq 'COUNTRY' and SpatialDim in ('JPN')` works correctly (verified). If more than one of `country_codes`, `region_codes`, `income_group_codes` are provided, the tool errors with a clear message rather than silently dropping one spatial type. If only `country_codes` are provided, `SpatialDimType eq 'COUNTRY' and SpatialDim in (...)` is used. If only `region_codes`, `SpatialDimType eq 'REGION' and SpatialDim in (...)`. If only `income_group_codes`, `SpatialDimType eq 'WORLDBANKINCOMEGROUP' and SpatialDim in (...)`. If none are provided, no spatial filter is applied (returns all geographies including UNREGION, UNSDGREGION rows — can be large, capped by `limit`).

Note: filtering by `SpatialDim in (...)` without a `SpatialDimType` filter works at the API level and returns all rows matching those spatial dim codes regardless of type. This is not exposed as a parameter — always pair with `SpatialDimType` to avoid mixing heterogeneous geographies in one result set.

**Year filter:** `TimeDim ge {year_from} and TimeDim le {year_to}` appended when provided.

**Cross-cutting filters:** `sex` adds `Dim1Type eq 'SEX' and Dim1 eq '{sex}'` and takes precedence over `dim1_value`. Positional values add escaped equality predicates on Dim1, Dim2, or Dim3. Discover positions from observation type/value pairs: metadata alone does not identify a slot. Empty values are ignored with a notice, and applied-filter echoes include only predicates actually used.

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
  totalCount: number
  hasMore: boolean
  nextOffset: number?
  notice: string?
errors:
  - dimension_not_found: NotFound — an unfiltered lookup has no values, or an empty parent-filtered lookup fails the dimension metadata existence check
annotations: readOnlyHint: true, openWorldHint: false
```

**Implementation note:** The values endpoint returns HTTP 200 with an empty array for both unknown dimensions and unmatched parent filters. For an empty parent-filtered selection, the service checks the dimension metadata endpoint before asserting existence. A metadata outage propagates as a failure rather than an absence claim. Values use deterministic Code ordering; an offset past a nonempty selection returns an empty page.

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
| `COUNTRY` | `JPN`, `USA`, `BRA`, historical WHO codes | Country-level data |
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

**6. Filters do not require a metadata lookup.** The sex filter adds a Dim1 SEX predicate; positional filters select their corresponding values. A wrong position can yield no data, so callers inspect observation type/value pairs when they do not already know the layout. Metadata lists types without positions and may be absent for valid indicators.

**7. Three positional filters share the query path.** Age and cause dimensions can occur beyond Dim1, so `dim2_value` and `dim3_value` select discovered coordinates without fetching and discarding other strata client-side. Returned type/value pairs retain all three positions independently, including sparse rows.

**8. PUBLISHSTATE filtered from metadata output.** The `/IndicatorDimension` endpoint returns `PUBLISHSTATE` as a dimension for many indicators. This is an internal publishing workflow dimension, not a data dimension callers can filter on in `who_query_indicator_data`. Strip it from `who_get_indicator_metadata` output to avoid confusing callers.

---

## Known Limitations

- **No indicator theme/category navigation.** The `DIMENSION/GHO/DimensionValues` endpoint supplies a flat list with `Code` and `Title` fields rather than a theme hierarchy. Use indicator search or catalog browsing for discovery.
- **Indicator codes are opaque.** Codes like `WHOSIS_000001` or `NCD_CCS_DiabetesTest` don't self-describe their domain. Agents must search by name.
- **Cross-spatial queries require multiple calls.** Comparing a specific country to its WHO region aggregate requires two separate `who_query_indicator_data` calls.
- **No dedicated subnational filter.** Spatial filter parameters select country, WHO region, or World Bank income-group codes; the tools do not expose a dedicated subnational selector.
- **Data currency varies by indicator.** Observation years describe the data period. The upstream `Date` field is not selected or exposed by the tools, so these responses cannot establish the last update timestamp.
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
