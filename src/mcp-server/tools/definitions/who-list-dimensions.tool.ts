/**
 * @fileoverview List all dimension type codes available in the WHO GHO API.
 * @module mcp-server/tools/definitions/who-list-dimensions
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoListDimensions = tool('who_list_dimensions', {
  title: 'List GHO Dimension Types',
  description:
    'List all dimension type codes and human-readable titles available in the WHO Global Health Observatory API. ' +
    'Use this to discover valid dimension codes before calling who_list_dimension_values. ' +
    'Common dimensions include COUNTRY, REGION, SEX, WORLDBANKINCOMEGROUP, and AGEGROUP, ' +
    'but many additional types exist — this tool exposes them all.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({}),
  output: z.object({
    dimensions: z
      .array(
        z
          .object({
            code: z.string().describe('Dimension type code, e.g. "COUNTRY", "SEX", "AGEGROUP".'),
            title: z.string().describe('Human-readable label for the dimension, e.g. "Age Group".'),
          })
          .describe('A single dimension type entry.'),
      )
      .describe('All available dimension types in the GHO catalog.'),
  }),

  async handler(_input, ctx) {
    ctx.log.info('Fetching GHO dimension list');
    const dimensions = await getGhoService().listDimensions(ctx);
    return { dimensions };
  },

  format: (result) => {
    const lines = [`**Dimension types (${result.dimensions.length} total):**`, ''];
    for (const d of result.dimensions) {
      lines.push(`- **${d.code}**: ${d.title}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
