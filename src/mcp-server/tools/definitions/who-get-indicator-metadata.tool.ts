/**
 * @fileoverview Fetch dimension metadata for one or more WHO GHO indicator codes.
 * @module mcp-server/tools/definitions/who-get-indicator-metadata
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoGetIndicatorMetadata = tool('who_get_indicator_metadata', {
  title: 'Get WHO GHO Indicator Metadata',
  description:
    'Get metadata for one or more WHO GHO indicator codes: the full indicator name and the dimensions ' +
    'it supports (e.g. COUNTRY, REGION, SEX, YEAR, WORLDBANKINCOMEGROUP, AGEGROUP). ' +
    'Call this before querying data with who_query_indicator_data to understand which filter dimensions ' +
    'are valid for a given indicator. Accepts up to 10 codes per call. ' +
    'Codes with no metadata (unknown codes) are reported in the notFound array rather than causing an error.',
  annotations: { readOnlyHint: true, openWorldHint: false },
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
                'Dimensions this indicator supports for filtering in who_query_indicator_data.',
              ),
          })
          .describe('Metadata for one indicator.'),
      )
      .describe('Metadata for each code that returned results.'),
    notFound: z
      .array(z.string())
      .describe(
        'Indicator codes that returned no metadata. The GHO API returns HTTP 200 with an empty value array for unknown codes.',
      ),
  }),

  errors: [
    {
      reason: 'all_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'All requested indicator codes returned empty metadata.',
      recovery:
        'Use who_search_indicators to find valid indicator codes matching your topic and retry.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching indicator metadata', { codes: input.indicator_codes });

    // Fan out all lookups in parallel: dimension metadata + indicator names (one search per code)
    const [dimMap, ...nameResults] = await Promise.all([
      getGhoService().getIndicatorDimensions(input.indicator_codes, ctx),
      ...input.indicator_codes.map((code) =>
        getGhoService().listIndicators({ query: code, limit: 5, offset: 0 }, ctx),
      ),
    ]);

    // Build name map from search results
    const nameMap = new Map<string, string>();
    for (let i = 0; i < input.indicator_codes.length; i++) {
      const code = input.indicator_codes[i];
      const result = nameResults[i];
      if (code && result && 'indicators' in result) {
        const match = result.indicators.find(
          (ind: { indicatorCode: string; indicatorName: string }) => ind.indicatorCode === code,
        );
        if (match) nameMap.set(code, match.indicatorName);
      }
    }

    const found: Array<{
      indicatorCode: string;
      indicatorName: string;
      dimensions: Array<{ dimension: string; dimensionName: string }>;
    }> = [];
    const notFound: string[] = [];

    for (const code of input.indicator_codes) {
      const dims = dimMap.get(code);
      if (!dims) {
        notFound.push(code);
      } else {
        found.push({
          indicatorCode: code,
          indicatorName: nameMap.get(code) ?? code,
          dimensions: dims,
        });
      }
    }

    if (found.length === 0) {
      throw ctx.fail('all_not_found', `None of the requested indicator codes returned metadata.`, {
        codes: input.indicator_codes,
        ...ctx.recoveryFor('all_not_found'),
      });
    }

    return { indicators: found, notFound };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const ind of result.indicators) {
      lines.push(`## ${ind.indicatorCode}: ${ind.indicatorName}`);
      lines.push(
        `**Dimensions:** ${ind.dimensions.map((d) => `${d.dimension} (${d.dimensionName})`).join(', ')}`,
      );
      lines.push('');
    }
    if (result.notFound.length > 0) {
      lines.push(`**Not found:** ${result.notFound.join(', ')}`);
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
