/**
 * @fileoverview Query data rows for a WHO GHO indicator with spatial, temporal, and dimension filters.
 * @module mcp-server/tools/definitions/who-query-indicator-data
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

const SEX_VALUES = ['SEX_BTSX', 'SEX_FMLE', 'SEX_MLE'] as const;

export const whoQueryIndicatorData = tool('who_query_indicator_data', {
  title: 'Query WHO GHO Indicator Data',
  description:
    'Query data rows for a single WHO GHO indicator with optional spatial, temporal, and dimension filters. ' +
    'Returns rows with numeric values, uncertainty intervals (Low/High), and spatial/time metadata. ' +
    'This is the primary data-fetching tool in the find-then-query workflow: ' +
    'use who_search_indicators to find the indicator code, optionally call who_get_indicator_metadata ' +
    'to confirm which filter dimensions are valid, then call this tool. ' +
    'Spatial filters are mutually exclusive per call: provide only one of country_codes, region_codes, ' +
    'or income_group_codes — mixing them triggers an error. ' +
    'Omitting all spatial filters returns all geographies (may be large; use limit to cap). ' +
    'The sex filter only applies when the indicator uses SEX as its first cross-cutting dimension — ' +
    'if not, the filter returns empty rows; check who_get_indicator_metadata first if uncertain.',
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
        'ISO 3166-1 alpha-3 country codes to filter on, e.g. ["JPN","USA","BRA"]. ' +
          'Mutually exclusive with region_codes and income_group_codes.',
      ),
    region_codes: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'WHO region codes to filter on, e.g. ["AFR","EUR","AMR","EMR","SEAR","WPR"]. ' +
          'Returns the aggregate row for each named WHO region — not per-country rows within it. ' +
          'To get country-level data for a region, use who_list_dimension_values with ' +
          'dimension="COUNTRY" and filter by parentCode to retrieve the ISO codes for countries ' +
          'in that region, then pass those to country_codes. ' +
          'Use who_list_dimension_values with dimension="REGION" to see all valid region codes. ' +
          'Mutually exclusive with country_codes and income_group_codes.',
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
    include_uncertainty: z
      .boolean()
      .default(true)
      .describe('Include Low and High uncertainty interval bounds in output. Default true.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(200)
      .describe('Maximum number of data rows to return. Default 200, max 1000.'),
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
            spatialLabel: z
              .string()
              .optional()
              .describe('Human-readable spatial label, e.g. WHO region name for a country row.'),
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
    notice: z
      .string()
      .optional()
      .describe(
        'Present when the limit was reached and not all rows were returned. Explains how to retrieve additional rows.',
      ),
  },

  enrichmentTrailer: {
    appliedFilters: {
      render: (filters) => {
        const parts: string[] = [`- **Indicator:** ${filters.indicatorCode}`];
        if (filters.spatialFilter) parts.push(`- **Spatial:** ${filters.spatialFilter}`);
        if (filters.yearRange) parts.push(`- **Years:** ${filters.yearRange}`);
        if (filters.sex) parts.push(`- **Sex:** ${filters.sex}`);
        if (filters.dim1Value) parts.push(`- **Dim1:** ${filters.dim1Value}`);
        return `**Applied Filters:**\n${parts.join('\n')}`;
      },
    },
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
  ],

  async handler(input, ctx) {
    // Validate mutual exclusion of spatial filters
    const spatialCount = [input.country_codes, input.region_codes, input.income_group_codes].filter(
      (arr) => arr?.length,
    ).length;
    if (spatialCount > 1) {
      throw ctx.fail(
        'ambiguous_spatial_filter',
        'Provide only one of country_codes, region_codes, or income_group_codes per call.',
        { ...ctx.recoveryFor('ambiguous_spatial_filter') },
      );
    }

    ctx.log.info('Querying indicator data', {
      indicatorCode: input.indicator_code,
      spatialCount,
      yearFrom: input.year_from,
      yearTo: input.year_to,
    });

    const queryParams = {
      indicatorCode: input.indicator_code,
      includeUncertainty: input.include_uncertainty,
      limit: input.limit,
      ...(input.country_codes?.length && { countryCodes: input.country_codes }),
      ...(input.region_codes?.length && { regionCodes: input.region_codes }),
      ...(input.income_group_codes?.length && { incomeGroupCodes: input.income_group_codes }),
      ...(input.year_from != null && { yearFrom: input.year_from }),
      ...(input.year_to != null && { yearTo: input.year_to }),
      ...(input.sex && { sex: input.sex }),
      ...(input.dim1_value && { dim1Value: input.dim1_value }),
    };
    const { rows, totalRows, truncated } = await getGhoService()
      .queryData(queryParams, ctx)
      .catch((err: unknown) => {
        // Re-fail 404s with the typed contract reason so the recovery hint reaches the client.
        // Checking data.reason rather than err.code avoids referencing NotFound in handler
        // source (which the linter flags as a direct throw bypassing ctx.fail).
        if (
          (err as { data?: { reason?: string } } | null)?.data?.reason === 'indicator_not_found'
        ) {
          throw ctx.fail(
            'indicator_not_found',
            `Indicator code "${input.indicator_code}" not found in the GHO catalog.`,
            { indicatorCode: input.indicator_code, ...ctx.recoveryFor('indicator_not_found') },
          );
        }
        throw err;
      });

    if (rows.length === 0) {
      throw ctx.fail(
        'no_data',
        `Indicator "${input.indicator_code}" returned no data for the applied filters.`,
        { indicatorCode: input.indicator_code, ...ctx.recoveryFor('no_data') },
      );
    }

    // Build a human-readable spatial filter summary for the enrichment echo.
    let spatialFilter: string | undefined;
    if (input.country_codes?.length)
      spatialFilter = `country_codes: ${input.country_codes.join(',')}`;
    else if (input.region_codes?.length)
      spatialFilter = `region_codes: ${input.region_codes.join(',')}`;
    else if (input.income_group_codes?.length)
      spatialFilter = `income_group_codes: ${input.income_group_codes.join(',')}`;

    const yearRange =
      input.year_from != null && input.year_to != null
        ? `${input.year_from}–${input.year_to}`
        : input.year_from != null
          ? `from ${input.year_from}`
          : input.year_to != null
            ? `to ${input.year_to}`
            : undefined;

    ctx.enrich({
      appliedFilters: {
        indicatorCode: input.indicator_code,
        ...(spatialFilter && { spatialFilter }),
        ...(yearRange && { yearRange }),
        ...(input.sex && { sex: input.sex }),
        ...(input.dim1_value && { dim1Value: input.dim1_value }),
      },
      totalRows,
      totalCount: totalRows,
    });
    if (truncated) {
      ctx.enrich.truncated({ shown: input.limit, cap: input.limit, ceiling: 1000 });
      ctx.enrich.notice(
        `Showing ${input.limit} of ${totalRows} rows. Narrow the filters (year range, spatial codes) or increase the limit (max 1000) to retrieve more.`,
      );
    }

    return { rows };
  },

  format: (result) => {
    const lines: string[] = [`**Rows returned: ${result.rows.length}**`, ''];
    for (const row of result.rows) {
      const spatial = [row.spatialDimType, row.spatialDim, row.spatialLabel]
        .filter(Boolean)
        .join(' / ');
      const dim1 = row.dim1Type ? ` | ${row.dim1Type}: ${row.dim1}` : '';
      const dim2 = row.dim2Type ? ` | ${row.dim2Type}: ${row.dim2}` : '';
      const displayPart = row.displayValue ? ` display=${row.displayValue}` : '';
      const numericPart = row.numericValue != null ? ` numeric=${row.numericValue}` : '';
      const uncertainty = row.low != null && row.high != null ? ` [${row.low}–${row.high}]` : '';
      const comments = row.comments ? ` — ${row.comments}` : '';
      const yearPart = row.year != null ? `**${row.year}**` : '**—**';
      lines.push(
        `- [${row.indicatorCode}] ${yearPart} | ${spatial}${dim1}${dim2}${displayPart}${numericPart}${uncertainty}${comments}`,
      );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
