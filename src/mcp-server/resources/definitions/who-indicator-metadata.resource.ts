/**
 * @fileoverview WHO GHO indicator metadata resource — fetch metadata by indicator code URI.
 * @module mcp-server/resources/definitions/who-indicator-metadata
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';
import { wellFormed } from '@/utils/well-formed.js';

/**
 * Emitted for a code that resolves in the `Indicator` catalog but has no rows in the
 * `IndicatorDimension` table — the state ~1,300 of the 3,089 catalog indicators are in,
 * most of which still return data. Names the fallback route to the same information.
 */
const DIMENSIONS_UNAVAILABLE =
  'The GHO dimension table lists no dimensions for this indicator. The code is valid and may ' +
  'still return data — call who_query_indicator_data for a sample row and read dim1Type and ' +
  'dim2Type to see which dimensions it actually uses.';

export const whoIndicatorMetadataResource = resource('who://indicator/{indicatorCode}/metadata', {
  name: 'who-indicator-metadata',
  description:
    'Metadata for a single WHO GHO indicator: full name and the dimension types it supports for filtering. ' +
    'Dimensions come back empty with a dimensionsNote when the GHO dimension table lists none for the code — ' +
    'that is a gap upstream, not a missing indicator. ' +
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
      .describe(
        'Dimensions this indicator supports. Empty when the GHO dimension table lists none — see dimensionsNote.',
      ),
    dimensionsNote: z
      .string()
      .optional()
      .describe(
        'Present only when dimensions is empty: explains that the listing is missing upstream ' +
          'rather than the indicator being absent, and how to recover the dimensions from a sample data row.',
      ),
  }),

  async handler(params, ctx) {
    const svc = getGhoService();
    // Fetch dimension metadata and indicator name in parallel
    const [dimMap, nameResult] = await Promise.all([
      svc.getIndicatorDimensions([params.indicatorCode], ctx),
      svc.listIndicators({ indicatorCode: params.indicatorCode, limit: 1, offset: 0 }, ctx),
    ]);
    const dims = dimMap.get(params.indicatorCode) ?? [];
    const match = nameResult.indicators.find((i) => i.indicatorCode === params.indicatorCode);
    // The code reaches the upstream through `$filter`, never a URL path segment, so an
    // unpaired surrogate is encoded rather than refused and arrives here intact. Lookups
    // key on the code as received; the response carries the repaired copy.
    const echoedCode = wellFormed(params.indicatorCode);
    // Existence and dimension coverage are separate signals — the code is absent only
    // when neither resolves. An empty dimension list on a named code is an upstream gap.
    if (dims.length === 0 && !match) {
      throw notFound(
        `Indicator "${echoedCode}" does not exist in the GHO catalog. Use who_search_indicators to find valid codes.`,
        { indicatorCode: echoedCode },
      );
    }
    return {
      indicatorCode: echoedCode,
      indicatorName: match?.indicatorName ?? echoedCode,
      dimensions: dims,
      ...(dims.length === 0 && { dimensionsNote: DIMENSIONS_UNAVAILABLE }),
    };
  },
});
