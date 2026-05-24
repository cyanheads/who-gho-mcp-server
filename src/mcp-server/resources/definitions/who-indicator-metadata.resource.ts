/**
 * @fileoverview WHO GHO indicator metadata resource — fetch metadata by indicator code URI.
 * @module mcp-server/resources/definitions/who-indicator-metadata
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoIndicatorMetadataResource = resource('who://indicator/{indicatorCode}/metadata', {
  name: 'who-indicator-metadata',
  description:
    'Metadata for a single WHO GHO indicator: full name and the dimension types it supports for filtering. ' +
    'Stable and suitable as injectable context before calling who_query_indicator_data.',
  mimeType: 'application/json',
  params: z.object({
    indicatorCode: z.string().describe('Indicator code, e.g. "WHOSIS_000001".'),
  }),
  output: z.object({
    indicatorCode: z.string().describe('Indicator code.'),
    indicatorName: z.string().describe('Full indicator name.'),
    dimensions: z
      .array(
        z
          .object({
            dimension: z.string().describe('Dimension type code, e.g. "COUNTRY", "SEX".'),
            dimensionName: z.string().describe('Human-readable dimension name.'),
          })
          .describe('A dimension entry supported by this indicator.'),
      )
      .describe('Dimensions this indicator supports.'),
  }),

  async handler(params, ctx) {
    const svc = getGhoService();
    // Fetch dimension metadata and indicator name in parallel
    const [dimMap, nameResult] = await Promise.all([
      svc.getIndicatorDimensions([params.indicatorCode], ctx),
      svc.listIndicators({ indicatorCode: params.indicatorCode, limit: 1, offset: 0 }, ctx),
    ]);
    const dims = dimMap.get(params.indicatorCode);
    if (!dims) {
      throw notFound(
        `Indicator "${params.indicatorCode}" has no metadata — it may not exist. Use who_search_indicators to find valid codes.`,
        { indicatorCode: params.indicatorCode },
      );
    }
    const match = nameResult.indicators.find((i) => i.indicatorCode === params.indicatorCode);
    return {
      indicatorCode: params.indicatorCode,
      indicatorName: match?.indicatorName ?? params.indicatorCode,
      dimensions: dims,
    };
  },
});
