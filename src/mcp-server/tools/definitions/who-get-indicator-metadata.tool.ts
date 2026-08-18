/**
 * @fileoverview Fetch dimension metadata for one or more WHO GHO indicator codes.
 * @module mcp-server/tools/definitions/who-get-indicator-metadata
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

/**
 * Emitted for a code that resolves in the `Indicator` catalog but has no rows in the
 * `IndicatorDimension` table — the state ~1,300 of the 3,089 catalog indicators are in,
 * most of which still return data. Names the fallback route to the same information.
 */
const DIMENSIONS_UNAVAILABLE =
  'The GHO dimension table lists no dimensions for this indicator. The code is valid and may ' +
  'still return data — call who_query_indicator_data for a sample row and read dim1Type and ' +
  'dim2Type to see which dimensions it actually uses.';

export const whoGetIndicatorMetadata = tool('who_get_indicator_metadata', {
  title: 'Get WHO GHO Indicator Metadata',
  description:
    'Fetch metadata for one or more WHO GHO indicator codes: the full indicator name and the dimensions ' +
    'it supports (e.g. COUNTRY, REGION, SEX, YEAR, WORLDBANKINCOMEGROUP, AGEGROUP). ' +
    'Call this before querying data with who_query_indicator_data to confirm which filter dimensions ' +
    'are valid for a given indicator. Accepts up to 10 codes per call. ' +
    'Many valid indicators have no dimension listing upstream — those return an empty dimensions ' +
    'array with a dimensionsNote, not a not-found. Only codes absent from the catalog are ' +
    'reported in the notFound array, and that is reported rather than raised as an error.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    indicator_codes: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .describe('One to ten indicator codes, e.g. ["WHOSIS_000001", "MDG_0000000026"].'),
  }),
  output: z.object({
    indicators: z
      .array(
        z
          .object({
            indicatorCode: z.string().describe('Indicator code.'),
            indicatorName: z
              .string()
              .describe('Full indicator name as returned by the GHO catalog.'),
            dimensions: z
              .array(
                z
                  .object({
                    dimension: z
                      .string()
                      .describe(
                        'Dimension type code, e.g. "COUNTRY", "SEX", "WORLDBANKINCOMEGROUP".',
                      ),
                    dimensionName: z
                      .string()
                      .describe('Human-readable dimension name, e.g. "Country", "Sex".'),
                  })
                  .describe('A dimension entry supported by this indicator.'),
              )
              .describe(
                'Dimensions this indicator supports for filtering in who_query_indicator_data. ' +
                  'Empty when the GHO dimension table lists none for this code — see dimensionsNote.',
              ),
            dimensionsNote: z
              .string()
              .optional()
              .describe(
                'Present only when dimensions is empty: explains that the listing is missing ' +
                  'upstream rather than the indicator being absent, and how to recover the ' +
                  'dimensions from a sample data row.',
              ),
          })
          .describe('Metadata for one indicator.'),
      )
      .describe('Metadata for each code that resolved to a catalog entry.'),
    notFound: z
      .array(z.string())
      .describe(
        'Indicator codes that resolved to neither a catalog name nor any dimension rows — they do not exist in the GHO catalog.',
      ),
  }),

  errors: [
    {
      reason: 'all_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No requested indicator code resolved to a catalog entry.',
      recovery:
        'Use who_search_indicators to find valid indicator codes matching your topic and retry.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching indicator metadata', { codes: input.indicator_codes });

    const svc = getGhoService();
    // Fan out all lookups in parallel: dimension metadata + indicator names (exact code lookup)
    const [dimMap, ...nameResults] = await Promise.all([
      svc.getIndicatorDimensions(input.indicator_codes, ctx),
      ...input.indicator_codes.map((code) =>
        svc.listIndicators({ indicatorCode: code, limit: 1, offset: 0 }, ctx),
      ),
    ]);

    // Build name map from search results
    const nameMap = new Map<string, string>();
    for (let i = 0; i < input.indicator_codes.length; i++) {
      const code = input.indicator_codes[i];
      const result = nameResults[i];
      if (code && result) {
        const match = result.indicators.find((ind) => ind.indicatorCode === code);
        if (match) nameMap.set(code, match.indicatorName);
      }
    }

    const found: Array<{
      indicatorCode: string;
      indicatorName: string;
      dimensions: Array<{ dimension: string; dimensionName: string }>;
      dimensionsNote?: string;
    }> = [];
    const notFound: string[] = [];

    // Existence and dimension coverage are separate signals. A code is absent only when
    // neither resolves; an empty dimension list on a code the catalog names is a gap in
    // the upstream IndicatorDimension table, not a missing indicator.
    for (const code of input.indicator_codes) {
      const dims = dimMap.get(code) ?? [];
      const name = nameMap.get(code);
      if (dims.length === 0 && name === undefined) {
        notFound.push(code);
        continue;
      }
      found.push({
        indicatorCode: code,
        indicatorName: name ?? code,
        dimensions: dims,
        ...(dims.length === 0 && { dimensionsNote: DIMENSIONS_UNAVAILABLE }),
      });
    }

    if (found.length === 0) {
      throw ctx.fail(
        'all_not_found',
        'None of the requested indicator codes resolved to a GHO catalog entry.',
        {
          codes: input.indicator_codes,
          ...ctx.recoveryFor('all_not_found'),
        },
      );
    }

    return { indicators: found, notFound };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const ind of result.indicators) {
      lines.push(`## ${ind.indicatorCode}: ${ind.indicatorName}`);
      lines.push(
        ind.dimensions.length > 0
          ? `**Dimensions:** ${ind.dimensions.map((d) => `${d.dimension} (${d.dimensionName})`).join(', ')}`
          : '**Dimensions:** none listed',
      );
      if (ind.dimensionsNote) lines.push(`**dimensionsNote:** ${ind.dimensionsNote}`);
      lines.push('');
    }
    if (result.notFound.length > 0) {
      lines.push(`**Not found:** ${result.notFound.join(', ')}`);
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
