/**
 * @fileoverview WHO GHO dimension values resource — fetch valid values for a dimension type by URI.
 * @module mcp-server/resources/definitions/who-dimension-values
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoDimensionValuesResource = resource('who://dimension/{dimensionCode}/values', {
  name: 'who-dimension-values',
  description:
    'All valid values for a WHO GHO dimension type. Stable and useful as injectable context ' +
    'when building queries with who_query_indicator_data. ' +
    'Use who_list_dimensions to discover valid dimension type codes.',
  mimeType: 'application/json',
  params: z.object({
    dimensionCode: z
      .string()
      .describe('Dimension type code, e.g. "COUNTRY", "REGION", "SEX", "WORLDBANKINCOMEGROUP".'),
  }),
  output: z.object({
    dimension: z.string().describe('The requested dimension type code.'),
    values: z
      .array(
        z
          .object({
            code: z.string().describe('Dimension value code.'),
            label: z.string().describe('Human-readable label.'),
            parentCode: z.string().optional().describe('Parent value code when hierarchical.'),
            parentLabel: z.string().optional().describe('Human-readable parent label.'),
            parentDimension: z.string().optional().describe('Parent dimension type.'),
          })
          .describe('A single valid value for this dimension type.'),
      )
      .describe('Valid values for the dimension.'),
  }),

  async handler(params, ctx) {
    const values = await getGhoService().listDimensionValues(params.dimensionCode, ctx);
    if (values.length === 0) {
      throw notFound(
        `Dimension "${params.dimensionCode}" returned no values — it may not exist. Use who_list_dimensions to discover valid codes.`,
        { dimensionCode: params.dimensionCode },
      );
    }
    return { dimension: params.dimensionCode, values };
  },
});
