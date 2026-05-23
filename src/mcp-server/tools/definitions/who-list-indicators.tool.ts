/**
 * @fileoverview Browse the WHO GHO indicator catalog with pagination.
 * @module mcp-server/tools/definitions/who-list-indicators
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoListIndicators = tool('who_list_indicators', {
  title: 'List WHO GHO Indicators',
  description:
    'Browse the WHO Global Health Observatory catalog of 3,059 indicators with pagination. ' +
    'Use when you want to explore indicators without a keyword, or to page through the full catalog. ' +
    'Use who_search_indicators when you have a keyword to narrow the results.',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe('Number of indicators to return per page. Default 50, max 500.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Zero-based offset for pagination. Default 0.'),
  }),
  output: z.object({
    indicators: z
      .array(
        z
          .object({
            indicatorCode: z
              .string()
              .describe(
                'Unique indicator code used in who_query_indicator_data, e.g. "WHOSIS_000001".',
              ),
            indicatorName: z
              .string()
              .describe('Full indicator name, e.g. "Life expectancy at birth (years)".'),
          })
          .describe('An indicator entry with its code and name.'),
      )
      .describe('Indicators for the requested page.'),
    total: z
      .number()
      .describe('Total number of indicators in the catalog (3,059 as of publication).'),
    hasMore: z.boolean().describe('True when more indicators exist beyond the current page.'),
  }),

  async handler(input, ctx) {
    ctx.log.info('Listing indicators', { limit: input.limit, offset: input.offset });
    const { indicators, total } = await getGhoService().listIndicators(
      { limit: input.limit, offset: input.offset },
      ctx,
    );
    return {
      indicators,
      total,
      hasMore: input.offset + indicators.length < total,
    };
  },

  format: (result) => {
    const lines = [
      `**Indicators (${result.indicators.length} shown, ${result.total} total, hasMore: ${result.hasMore}):**`,
      '',
    ];
    for (const ind of result.indicators) {
      lines.push(`- **${ind.indicatorCode}**: ${ind.indicatorName}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
