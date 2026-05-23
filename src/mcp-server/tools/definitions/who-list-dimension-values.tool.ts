/**
 * @fileoverview List valid values for a WHO GHO dimension type.
 * @module mcp-server/tools/definitions/who-list-dimension-values
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoListDimensionValues = tool('who_list_dimension_values', {
  title: 'List GHO Dimension Values',
  description:
    'List valid codes and labels for a WHO GHO dimension type such as COUNTRY, REGION, SEX, ' +
    'WORLDBANKINCOMEGROUP, or AGEGROUP. Use this to discover valid filter values before calling ' +
    'who_query_indicator_data, or to confirm the correct ISO code for a country. ' +
    'Use who_list_dimensions to discover all available dimension type codes.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    dimension: z
      .string()
      .min(1)
      .describe(
        'Dimension type code. Use who_list_dimensions to discover all available codes. ' +
          'Common values: COUNTRY, REGION, SEX, WORLDBANKINCOMEGROUP, AGEGROUP.',
      ),
  }),
  output: z.object({
    dimension: z.string().describe('The requested dimension type code.'),
    values: z
      .array(
        z
          .object({
            code: z
              .string()
              .describe('Dimension value code used as a filter in who_query_indicator_data.'),
            label: z.string().describe('Human-readable label for this value.'),
            parentCode: z
              .string()
              .optional()
              .describe('Parent value code, e.g. the WHO region code for a country entry.'),
            parentLabel: z
              .string()
              .optional()
              .describe('Human-readable label for the parent value.'),
            parentDimension: z
              .string()
              .optional()
              .describe('Parent dimension type, e.g. "REGION" for country entries.'),
          })
          .describe('A single valid value for this dimension type.'),
      )
      .describe('Valid values for this dimension type.'),
  }),

  errors: [
    {
      reason: 'dimension_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The dimension code returned no values — it may not exist in the GHO catalog.',
      recovery:
        'Use who_list_dimensions to discover valid dimension type codes and retry with a correct code.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching dimension values', { dimension: input.dimension });
    const values = await getGhoService().listDimensionValues(input.dimension, ctx);
    if (values.length === 0) {
      throw ctx.fail(
        'dimension_not_found',
        `Dimension "${input.dimension}" returned no values — it may not exist.`,
        {
          ...ctx.recoveryFor('dimension_not_found'),
        },
      );
    }
    return { dimension: input.dimension, values };
  },

  format: (result) => {
    const lines = [`**Dimension: ${result.dimension}** (${result.values.length} values)`, ''];
    for (const v of result.values) {
      const parentCode = v.parentCode ? ` parentCode=${v.parentCode}` : '';
      const parentLabel = v.parentLabel ? ` parentLabel=${v.parentLabel}` : '';
      const parentDimension = v.parentDimension ? ` parentDimension=${v.parentDimension}` : '';
      lines.push(`- **${v.code}**: ${v.label}${parentCode}${parentLabel}${parentDimension}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
