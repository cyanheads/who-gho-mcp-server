/**
 * @fileoverview WHO GHO indicator metadata resource — fetch metadata by indicator code URI.
 * @module mcp-server/resources/definitions/who-indicator-metadata
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';
import { wellFormed } from '@/utils/well-formed.js';

export const whoIndicatorMetadataResource = resource('who://indicator/{indicatorCode}/metadata', {
  name: 'who-indicator-metadata',
  description:
    'Metadata for a single WHO GHO indicator: canonical code, full name, and the dimension types it supports for filtering. Dimensions come back empty with a dimensionsNote when the GHO dimension table lists none for the code — that is a gap upstream, not a missing indicator. Stable and suitable as injectable context before calling who_query_indicator_data.',
  mimeType: 'application/json',
  params: z.object({
    indicatorCode: z.string().describe('Indicator code, e.g. "WHOSIS_000001".'),
  }),
  output: z.object({
    indicatorCode: z
      .string()
      .describe(
        'Canonical catalog code when resolved; otherwise the requested dimension-only code.',
      ),
    indicatorName: z
      .string()
      .describe('Decoded catalog name; the code itself when only dimension metadata resolves.'),
    dimensions: z
      .array(
        z
          .object({
            dimension: z.string().describe('Dimension type code, e.g. "COUNTRY", "SEX".'),
            dimensionName: z.string().describe('Human-readable dimension name.'),
          })
          .describe('A dimension entry supported by this indicator.'),
      )
      .describe(
        'Dimensions this indicator supports. Empty when the GHO dimension table lists none — see dimensionsNote.',
      ),
    dimensionsNote: z
      .string()
      .optional()
      .describe(
        'Present only when dimensions is empty: explains that the listing is missing upstream rather than the indicator being absent, and how to recover the dimensions from a sample data row.',
      ),
  }),

  async handler(params, ctx) {
    const { indicators } = await getGhoService().getIndicatorMetadata([params.indicatorCode], ctx);
    const indicator = indicators[0];
    if (!indicator) {
      const echoedCode = wellFormed(params.indicatorCode);
      throw notFound(
        `Indicator "${echoedCode}" does not exist in the GHO catalog. Use who_search_indicators to find valid codes.`,
        { indicatorCode: echoedCode },
      );
    }
    return indicator;
  },
});
