/**
 * @fileoverview Query data rows for a WHO GHO indicator with spatial, temporal, and dimension filters.
 * @module mcp-server/tools/definitions/who-query-indicator-data
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';
import { getGhoService } from '@/services/gho/gho-service.js';
import { applyReadLimit, readLimitSchema } from '@/utils/read-limit.js';
import { wellFormed } from '@/utils/well-formed.js';

const SEX_VALUES = ['SEX_BTSX', 'SEX_FMLE', 'SEX_MLE'] as const;

/**
 * Per sort mode: the OData `$orderby` clause sent upstream, the `label` echoed back in
 * the applied-filters enrichment, and how the returned `slice` is named in the truncation
 * notice. Every clause terminates in `Id` — a unique row key — so the ordering is total:
 * without it, rows sharing (TimeDim, SpatialDim, Dim1) but differing in Dim2/Dim3 form a
 * tie group the upstream may order freely, which would let offset paging repeat rows on
 * one page and omit them from another.
 */
const SORT_MODES = {
  year_desc: {
    orderBy: 'TimeDim desc,SpatialDim,Dim1,Id',
    label: 'most recent first (year_desc)',
    slice: 'most recent',
  },
  year_asc: {
    orderBy: 'TimeDim asc,SpatialDim,Dim1,Id',
    label: 'earliest first (year_asc)',
    slice: 'earliest',
  },
} as const;

export const whoQueryIndicatorData = tool('who_query_indicator_data', {
  title: 'Query WHO GHO Indicator Data',
  description:
    'Query data rows for a single WHO GHO indicator with optional spatial, temporal, and dimension filters. Returns rows with numeric values, uncertainty intervals (Low/High), and spatial/time metadata. This is the primary data-fetching tool in the find-then-query workflow: use who_search_indicators to find the indicator code, optionally call who_get_indicator_metadata to confirm which filter dimensions are valid, then call this tool. Discover positional filters from returned dim1Type/dim1, dim2Type/dim2 and dim3Type/dim3 pairs; metadata alone does not identify a slot. Spatial filters are mutually exclusive per call: provide only one of country_codes, region_codes, or income_group_codes — mixing them triggers an error. Omitting all spatial filters returns all geographies (may be large; use limit to cap). The sex filter only applies when the indicator uses SEX as its first cross-cutting dimension — if not, the filter returns empty rows; check who_get_indicator_metadata first if uncertain. Rows are returned in a deterministic order (most recent first by default), so a capped result is the top of a defined slice rather than an arbitrary sample; page through the rest with offset.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    indicator_code: z
      .string()
      .min(1)
      .describe(
        'Indicator code to query, e.g. "WHOSIS_000001". Use who_search_indicators to find codes.',
      ),
    country_codes: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'WHO country codes to filter on, e.g. ["JPN","USA","BRA"], including historical codes such as ME1 and SDN736. Discover codes with who_list_dimension_values dimension="COUNTRY". Mutually exclusive with region_codes and income_group_codes.',
      ),
    region_codes: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'WHO region codes to filter on, e.g. ["AFR","EUR","AMR","EMR","SEAR","WPR"]. Returns the aggregate row for each named WHO region. To get country-level data for a region, use who_list_dimension_values with dimension="COUNTRY" and parent_code set to the region code to retrieve WHO country codes, then pass those to country_codes. Use who_list_dimension_values with dimension="REGION" to see all valid region codes. Mutually exclusive with country_codes and income_group_codes.',
      ),
    income_group_codes: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'World Bank income group codes, e.g. ["WB_HI","WB_LMI","WB_LI","WB_UMI"]. ' +
          'Use who_list_dimension_values with dimension="WORLDBANKINCOMEGROUP" to see all valid codes. ' +
          'Mutually exclusive with country_codes and region_codes.',
      ),
    year_from: z
      .number()
      .int()
      .optional()
      .describe('Start year (inclusive) for the time range filter, e.g. 2015.'),
    year_to: z
      .number()
      .int()
      .optional()
      .describe('End year (inclusive) for the time range filter, e.g. 2023.'),
    sex: z
      .enum(SEX_VALUES)
      .optional()
      .describe(
        'Filter on sex dimension: SEX_BTSX (both sexes), SEX_FMLE (female), SEX_MLE (male). ' +
          'Only applies when the indicator uses SEX as its first cross-cutting dimension.',
      ),
    dim1_value: z
      .string()
      .optional()
      .describe(
        'Value filter for indicators whose first cross-cutting dimension is not SEX ' +
          '(e.g. an AGEGROUP code like "YEARS05-14"). Ignored when sex is also provided.',
      ),
    dim2_value: z
      .string()
      .optional()
      .describe(
        'Value filter for the second cross-cutting dimension, e.g. AGEGROUP_DAYS0-27. Discover the position from returned dim2Type/dim2 pairs; metadata does not identify the slot. Empty strings are ignored with a notice.',
      ),
    dim3_value: z
      .string()
      .optional()
      .describe(
        'Value filter for the third cross-cutting dimension, e.g. CHILDCAUSE_CH9. Discover the position from returned dim3Type/dim3 pairs; metadata does not identify the slot. Empty strings are ignored with a notice.',
      ),
    include_uncertainty: z
      .boolean()
      .default(true)
      .describe('Include Low and High uncertainty interval bounds in output. Default true.'),
    limit: readLimitSchema(1000)
      .default(200)
      .describe('Maximum number of data rows to return. Default 200, max 1000.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based row offset for pagination. Default 0. Pages are stable because rows are ' +
          'returned in a deterministic order — read hasMore and nextOffset from the response to ' +
          'continue. An offset at or beyond totalRows returns an empty rows array, not an error.',
      ),
    sort: z
      .enum(['year_desc', 'year_asc'])
      .default('year_desc')
      .describe(
        'Row ordering: "year_desc" (default) returns the most recent years first, "year_asc" the ' +
          'earliest first. Ties are broken by spatial code, then dimension, then row id.',
      ),
  }),
  output: z.object({
    rows: z
      .array(
        z
          .object({
            indicatorCode: z.string().describe('Indicator code for this row.'),
            spatialDimType: z
              .string()
              .optional()
              .describe(
                'Spatial dimension type: COUNTRY, REGION, WORLDBANKINCOMEGROUP, GLOBAL, etc.',
              ),
            spatialDim: z
              .string()
              .optional()
              .describe('Spatial dimension value, e.g. "JPN", "AFR", "WB_HI".'),
            parentLocation: z
              .string()
              .optional()
              .describe(
                'Name of the WHO region this row sits under, e.g. "Western Pacific" for a JPN row. ' +
                  'Not a label for spatialDim itself — the upstream row carries no name for its own ' +
                  'spatial entity. Absent when spatialDim is already a region or income group.',
              ),
            parentLocationCode: z
              .string()
              .optional()
              .describe(
                'Code of the WHO region this row sits under, e.g. "WPR". Pass to region_codes to ' +
                  "query that region's own aggregate rows. Absent alongside parentLocation.",
              ),
            year: z
              .number()
              .optional()
              .describe(
                'Year of the data point. Absent when the upstream row has no TimeDim (time-independent entries).',
              ),
            dim1Type: z
              .string()
              .optional()
              .describe('First cross-cutting dimension type, e.g. "SEX".'),
            dim1: z
              .string()
              .optional()
              .describe('First cross-cutting dimension value, e.g. "SEX_BTSX".'),
            dim2Type: z
              .string()
              .optional()
              .describe('Second cross-cutting dimension type, e.g. "AGEGROUP".'),
            dim2: z.string().optional().describe('Second cross-cutting dimension value.'),
            dim3Type: z
              .string()
              .optional()
              .describe('Third cross-cutting dimension type, e.g. CHILDCAUSE.'),
            dim3: z.string().optional().describe('Third cross-cutting dimension value.'),
            numericValue: z.number().optional().describe('Machine-readable numeric value.'),
            low: z
              .number()
              .optional()
              .describe(
                'Lower bound of the uncertainty interval. Present when include_uncertainty is true and the upstream provides it.',
              ),
            high: z
              .number()
              .optional()
              .describe(
                'Upper bound of the uncertainty interval. Present when include_uncertainty is true and the upstream provides it.',
              ),
            displayValue: z
              .string()
              .optional()
              .describe('Formatted display string as provided by WHO, e.g. "84.5 [84.5-84.5]".'),
            comments: z
              .string()
              .optional()
              .describe('Data source notes or comments attached to this row.'),
          })
          .describe('A single data row from the GHO indicator dataset.'),
      )
      .describe('Data rows matching the query.'),
  }),

  // Agent-facing result context: effective filter echo, total row count, and truncation
  // notice when the limit was reached. Lives in enrichment so it reaches structuredContent
  // + content[] alike without a format() entry.
  enrichment: {
    appliedFilters: z
      .object({
        indicatorCode: z.string().describe('Indicator code that was queried.'),
        spatialFilter: z
          .string()
          .optional()
          .describe(
            'Active spatial filter summary, e.g. "country_codes: JPN,USA" or "region_codes: EUR".',
          ),
        yearRange: z
          .string()
          .optional()
          .describe('Applied year range, e.g. "2015–2023". Absent when no year filter was set.'),
        sex: z.string().optional().describe('Sex filter value applied, if any.'),
        dim1Value: z.string().optional().describe('dim1_value filter applied, if any.'),
        dim2Value: z.string().optional().describe('dim2_value filter applied, if any.'),
        dim3Value: z.string().optional().describe('dim3_value filter applied, if any.'),
        ordering: z
          .string()
          .describe('Row ordering applied to the query, e.g. "most recent first (year_desc)".'),
      })
      .describe('Filters that were applied to the query.'),
    totalRows: z
      .number()
      .describe('Total row count matching the query on the server (before the limit is applied).'),
    totalCount: z
      .number()
      .describe('Alias of totalRows for cross-tool consistency — total rows before the limit.'),
    truncated: z
      .boolean()
      .optional()
      .describe('True when the result was capped at the requested limit.'),
    offset: z.number().describe('Zero-based row offset this page started at.'),
    hasMore: z
      .boolean()
      .describe('True when rows remain beyond this page. Pair with nextOffset to continue.'),
    pageInfo: z
      .string()
      .describe(
        'Human-readable page position, e.g. "offset 0, showing 200 of 12936". Use to construct the next offset.',
      ),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'Offset to request for the next page. Absent when this page reached the end of the result set.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Present when rows were withheld or the requested offset ran past the end of the result set. Explains how to reach the remaining rows.',
      ),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) => {
        const parts: string[] = [`- **Indicator:** ${escapeMarkdownInline(filters.indicatorCode)}`];
        if (filters.spatialFilter)
          parts.push(`- **Spatial:** ${escapeMarkdownInline(filters.spatialFilter)}`);
        if (filters.yearRange)
          parts.push(`- **Years:** ${escapeMarkdownInline(filters.yearRange)}`);
        if (filters.sex) parts.push(`- **Sex:** ${escapeMarkdownInline(filters.sex)}`);
        if (filters.dim1Value) parts.push(`- **Dim1:** ${escapeMarkdownInline(filters.dim1Value)}`);
        if (filters.dim2Value) parts.push(`- **Dim2:** ${escapeMarkdownInline(filters.dim2Value)}`);
        if (filters.dim3Value) parts.push(`- **Dim3:** ${escapeMarkdownInline(filters.dim3Value)}`);
        parts.push(`- **Ordering:** ${escapeMarkdownInline(filters.ordering)}`);
        return `**Applied Filters:**\n${parts.join('\n')}`;
      },
    },
    notice: { render: (notice: string) => `**Notice:** ${escapeMarkdownInline(notice)}` },
  },

  errors: [
    {
      reason: 'indicator_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The indicator code returned HTTP 404 from the GHO API.',
      recovery: 'Use who_search_indicators to find the correct indicator code and retry.',
    },
    {
      reason: 'no_data',
      code: JsonRpcErrorCode.NotFound,
      when: 'The indicator exists but no data rows matched the applied filters.',
      recovery:
        'Broaden the filters: remove year range, try different spatial codes, or remove the sex filter. ' +
        'Use who_get_indicator_metadata to confirm which dimensions this indicator supports.',
    },
    {
      reason: 'ambiguous_spatial_filter',
      code: JsonRpcErrorCode.ValidationError,
      when: 'More than one of country_codes, region_codes, or income_group_codes were provided.',
      recovery:
        'Provide only one spatial filter type per call. To compare countries and regions, make separate calls.',
    },
    {
      reason: 'invalid_year_range',
      code: JsonRpcErrorCode.ValidationError,
      when: 'year_from is greater than year_to, so the time filter can match no rows.',
      recovery:
        'Set year_from less than or equal to year_to, or drop one bound to leave the range open.',
    },
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.ValidationError,
      when: 'The GHO API rejected the generated OData query because a supplied filter value is not a valid literal.',
      recovery:
        'Check the spatial codes and dim1_value, dim2_value, or dim3_value for stray quotes or punctuation, then confirm valid codes with who_list_dimension_values and retry.',
    },
    {
      reason: 'malformed_identifier',
      code: JsonRpcErrorCode.ValidationError,
      when: 'indicator_code carries an unpaired UTF-16 surrogate, so it cannot be encoded into the request URL.',
      recovery:
        'Re-send indicator_code as text with no unpaired UTF-16 surrogate — codes are ASCII letters, digits, and underscores, and who_search_indicators returns valid ones.',
    },
  ],

  async handler(input, ctx) {
    const { limit, notice: clampNotice } = applyReadLimit(
      input.limit,
      1000,
      'who_query_indicator_data',
      ctx,
    );
    // Validate mutual exclusion of spatial filters
    const spatialCount = [input.country_codes, input.region_codes, input.income_group_codes].filter(
      (arr) => arr?.length,
    ).length;
    if (spatialCount > 1) {
      throw ctx.fail(
        'ambiguous_spatial_filter',
        'Provide only one of country_codes, region_codes, or income_group_codes per call.',
      );
    }

    if (input.year_from != null && input.year_to != null && input.year_from > input.year_to) {
      throw ctx.fail(
        'invalid_year_range',
        `year_from (${input.year_from}) is after year_to (${input.year_to}), so the time filter matches no rows.`,
      );
    }

    // Echo copies for the response. `indicator_code` reaches a URL path segment, where
    // the service refuses an unpaired surrogate outright, so in practice only the filter
    // values can carry one this far — all are repaired so the echo boundary holds without
    // depending on which upstream route a value happens to take. The raw values still go
    // to the service, leaving the request and its fast-fail on the code unchanged.
    const echoedCode = wellFormed(input.indicator_code);

    ctx.log.info('Querying indicator data', {
      indicatorCode: input.indicator_code,
      spatialCount,
      yearFrom: input.year_from,
      yearTo: input.year_to,
    });

    const sortMode = SORT_MODES[input.sort];
    const queryParams = {
      indicatorCode: input.indicator_code,
      includeUncertainty: input.include_uncertainty,
      limit,
      offset: input.offset,
      orderBy: sortMode.orderBy,
      ...(input.country_codes?.length && { countryCodes: input.country_codes }),
      ...(input.region_codes?.length && { regionCodes: input.region_codes }),
      ...(input.income_group_codes?.length && { incomeGroupCodes: input.income_group_codes }),
      ...(input.year_from != null && { yearFrom: input.year_from }),
      ...(input.year_to != null && { yearTo: input.year_to }),
      ...(input.sex && { sex: input.sex }),
      ...(!input.sex && input.dim1_value && { dim1Value: input.dim1_value }),
      ...(input.dim2_value && { dim2Value: input.dim2_value }),
      ...(input.dim3_value && { dim3Value: input.dim3_value }),
    };
    const { rows, totalRows, truncated } = await getGhoService()
      .queryData(queryParams, ctx)
      .catch((err: unknown) => {
        // Re-fail 404s with the typed contract reason so the recovery hint reaches the client.
        // Checking data.reason rather than err.code avoids referencing NotFound in handler
        // source (which the linter flags as a direct throw bypassing ctx.fail).
        const reason = (err as { data?: { reason?: string } } | null)?.data?.reason;
        // The rejected code is left out of the failure data on purpose: it is the
        // caller's own unpaired surrogate, and echoing it puts it back on the wire.
        if (reason === 'malformed_identifier') {
          throw ctx.fail(
            'malformed_identifier',
            'The indicator_code value cannot be encoded into a request URL — it contains an unpaired UTF-16 surrogate.',
          );
        }
        if (reason === 'invalid_query') {
          throw ctx.fail(
            'invalid_query',
            'The GHO API rejected the generated query — a supplied filter value is not a valid OData literal.',
            { indicatorCode: echoedCode },
          );
        }
        if (reason === 'indicator_not_found') {
          throw ctx.fail(
            'indicator_not_found',
            `Indicator code "${echoedCode}" not found in the GHO catalog.`,
            { indicatorCode: echoedCode },
          );
        }
        throw err;
      });

    // An empty page has two distinct causes once offset exists. Only one of them is
    // "the filters matched nothing"; paging past the end matched totalRows rows and
    // simply asked for a slice beyond them, so it returns an empty page, not an error.
    const pastEnd = totalRows > 0 && input.offset >= totalRows;
    if (rows.length === 0 && !pastEnd) {
      throw ctx.fail(
        'no_data',
        `Indicator "${echoedCode}" returned no data for the applied filters.`,
        { indicatorCode: echoedCode },
      );
    }

    // Build a human-readable spatial filter summary for the enrichment echo.
    let spatialFilter: string | undefined;
    if (input.country_codes?.length)
      spatialFilter = `country_codes: ${input.country_codes.map(wellFormed).join(',')}`;
    else if (input.region_codes?.length)
      spatialFilter = `region_codes: ${input.region_codes.map(wellFormed).join(',')}`;
    else if (input.income_group_codes?.length)
      spatialFilter = `income_group_codes: ${input.income_group_codes.map(wellFormed).join(',')}`;

    const yearRange =
      input.year_from != null && input.year_to != null
        ? `${input.year_from}–${input.year_to}`
        : input.year_from != null
          ? `from ${input.year_from}`
          : input.year_to != null
            ? `to ${input.year_to}`
            : undefined;

    const nextOffset = input.offset + rows.length;

    ctx.enrich({
      appliedFilters: {
        indicatorCode: echoedCode,
        ...(spatialFilter && { spatialFilter }),
        ...(yearRange && { yearRange }),
        ...(input.sex && { sex: input.sex }),
        ...(!input.sex && input.dim1_value && { dim1Value: wellFormed(input.dim1_value) }),
        ...(input.dim2_value && { dim2Value: wellFormed(input.dim2_value) }),
        ...(input.dim3_value && { dim3Value: wellFormed(input.dim3_value) }),
        ordering: sortMode.label,
      },
      totalRows,
      totalCount: totalRows,
      offset: input.offset,
      hasMore: truncated,
      pageInfo: `offset ${input.offset}, showing ${rows.length} of ${totalRows}`,
      ...(truncated && { nextOffset }),
    });

    const notices: string[] = clampNotice ? [clampNotice] : [];
    for (const field of ['country_codes', 'region_codes', 'income_group_codes'] as const) {
      if (input[field]?.length === 0) notices.push(`Ignored ${field}: the array is empty.`);
    }
    for (const field of ['dim1_value', 'dim2_value', 'dim3_value'] as const) {
      if (input[field] === '') notices.push(`Ignored ${field}: the string is empty.`);
    }
    if (input.sex && input.dim1_value)
      notices.push('Ignored dim1_value because sex takes precedence.');
    const requestedCodes = input.country_codes?.length
      ? input.country_codes
      : input.region_codes?.length
        ? input.region_codes
        : input.income_group_codes;
    if (requestedCodes?.length && input.offset === 0 && !truncated) {
      const returnedCodes = new Set(
        rows.flatMap((row) => (row.spatialDim === undefined ? [] : [row.spatialDim.toUpperCase()])),
      );
      const unmatched = requestedCodes.filter((code) => !returnedCodes.has(code.toUpperCase()));
      if (unmatched.length)
        notices.push(
          `Spatial codes with unknown code or no data for these filters: ${unmatched.map(wellFormed).join(', ')}.`,
        );
    }
    if (truncated) {
      const guidance = `Showing the ${sortMode.slice} ${rows.length} of ${totalRows} rows (offset ${input.offset}). Request offset ${nextOffset} for the next page, raise the limit (max 1000), or narrow the filters (year range, spatial codes).`;
      ctx.enrich.truncated({
        shown: rows.length,
        cap: limit,
        ceiling: 1000,
        guidance,
      });
      notices.push(guidance);
    } else if (pastEnd) {
      notices.push(
        `Offset ${input.offset} is at or beyond the ${totalRows} rows matching these filters; the last reachable offset is ${totalRows - 1}.`,
      );
    }
    if (notices.length) ctx.enrich.notice(notices.join(' '));

    return { rows };
  },

  format: (result) => {
    const lines: string[] = [`**Rows returned: ${result.rows.length}**`, ''];
    for (const row of result.rows) {
      const spatial = [row.spatialDimType, row.spatialDim]
        .filter((value) => value !== undefined)
        .map(escapeMarkdownInline)
        .join(' / ');
      // The parent region gets its own labelled segment. Slash-joined onto the spatial
      // group it read as a third coordinate of the row's own location instead.
      const parentParts = [
        row.parentLocation !== undefined ? escapeMarkdownInline(row.parentLocation) : undefined,
        row.parentLocationCode !== undefined
          ? `(${escapeMarkdownInline(row.parentLocationCode)})`
          : undefined,
      ].filter((value) => value !== undefined);
      const parent = parentParts.length > 0 ? ` — parent: ${parentParts.join(' ')}` : '';
      const dimensions = [
        [row.dim1Type, row.dim1],
        [row.dim2Type, row.dim2],
        [row.dim3Type, row.dim3],
      ]
        .map(([type, value], index) => {
          if (type === undefined && value === undefined) return '';
          const label = type === undefined ? `Dim${index + 1}` : escapeMarkdownInline(type);
          return value === undefined
            ? ` | ${label}`
            : ` | ${label}: ${escapeMarkdownInline(value)}`;
        })
        .join('');
      const displayPart =
        row.displayValue !== undefined ? ` display=${escapeMarkdownInline(row.displayValue)}` : '';
      const numericPart = row.numericValue != null ? ` numeric=${row.numericValue}` : '';
      const uncertainty =
        row.low != null && row.high != null
          ? ` [${row.low}–${row.high}]`
          : row.low != null
            ? ` [low: ${row.low}]`
            : row.high != null
              ? ` [high: ${row.high}]`
              : '';
      const comments = row.comments !== undefined ? ` — ${escapeMarkdownInline(row.comments)}` : '';
      const yearPart = row.year != null ? `**${row.year}**` : '**—**';
      lines.push(
        `- [${escapeMarkdownInline(row.indicatorCode)}] ${yearPart} | ${spatial}${parent}${dimensions}${displayPart}${numericPart}${uncertainty}${comments}`,
      );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
