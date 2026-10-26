---
name: who-gho-guide
description: Use with who_* tools to compare WHO GHO health indicators across countries or aggregates, discover age/sex/cause dimension positions, and distinguish missing metadata or incomplete pages from missing data.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use WHO GHO for country and aggregate health statistics, including life expectancy, disease, mortality, immunization, and health-system indicators. The upstream API is public and needs no key. These tools return catalog names, dimension catalogs, and observations; they do not provide clinical advice or complete indicator methodology. Observation years describe the data period, not when WHO last updated it; the tools do not expose an update timestamp.

## Identifiers

| Identifier | Source |
|:---|:---|
| Indicator code | `who_search_indicators` or `who_list_indicators`; use the returned canonical spelling, not a code inferred from a name |
| Dimension type | `who_list_dimensions`, indicator metadata, or an observation's dimension type |
| Dimension value | `who_list_dimension_values` for that type; join its code to the observation's value to recover a label |
| Country or aggregate code | The corresponding COUNTRY, REGION, or WORLDBANKINCOMEGROUP values; COUNTRY includes historical WHO codes beyond current ISO alpha-3 codes |

`parentLocation` and `parentLocationCode` describe the row's parent WHO region, not the name and code of the row's own geography. Resolve the row's `spatialDim` using its `spatialDimType` catalog.

## Gates

- Before comparing observations, confirm that indicator, geography type, year, sex, and any age/cause strata represent the intended comparison. Keep the full indicator name and actual observation years in the answer.
- Before applying an age or cause filter, inspect returned dimension type/value pairs. Metadata lists dimension types without assigning positions. Match a discovered value to its observed position; the same kind of dimension need not occupy the same slot across indicators.
- An empty metadata dimension list is not evidence that the indicator or its data is absent. Follow `dimensionsNote` with a constrained data query and inspect the rows. One sample shows the coordinates on that sample, not every stratum available for the indicator.
- Before an exhaustive ranking or an absence claim, follow pagination for the relevant selection and check coverage of every requested country or aggregate. A newest-first page across several countries does not establish the latest available observation for each one.
- Treat `no_data` as no observations matching the selected filters. Check code provenance and dimension positions, then broaden one filter at a time before concluding that data is unavailable. An upstream failure does not establish absence.
- Read notices and applied filters before interpreting results. An ignored empty filter does not restrict the query. Submit any metadata `unprocessedCodes` in subsequent calls; they have not been checked and do not belong in `notFound`.
- Preserve missing numeric values, years, dimensions, and uncertainty bounds as missing. Do not replace them with zero or infer a missing bound from the other bound.

## Workflows

### Compare countries or build a country profile

Resolve the intended measure by name and check its full catalog name before selecting a code. For multiple indicators, resolve each independently; similar names need not denote the same population or measure. Fetch matching country and dimension strata, then choose a common observation year for a direct comparison. If the task instead calls for each country's latest data, establish coverage separately for each country and label differing years. Follow pages until the selected comparison is complete, or explicitly report the uncovered countries or strata.

### Compare countries with a WHO regional aggregate

Resolve the region through `who_list_dimension_values`. To obtain its constituent countries, use the COUNTRY catalog's parent hierarchy and collect every page of matching country codes. Query those countries through `who_query_indicator_data`; query the region's own aggregate in a separate call. Keep country and aggregate rows distinct when presenting them. Use WHO's aggregate observation rather than substituting an average of country values.

### Explore age and cause breakdowns

Inspect indicator metadata, then obtain rows for a narrow geography and time range without speculative cross-cutting filters. Read every supplied dimension type/value pair and resolve labels in that type's catalog. For example, `MORT_100` can carry SEX in the first position, AGEGROUP in the second, and CHILDCAUSE in the third. Use the observed positions to select the age/cause strata, then check the returned coordinates against the intended selection. Retain cause and age coordinates when comparing rows that otherwise share country, year, and sex.

If metadata is missing, use the same row-discovery route. If a supplied type or value is absent from a sparse row, do not infer it from another row. The tool schemas own the available positional filters and their precedence.
