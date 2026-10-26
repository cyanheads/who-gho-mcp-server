/**
 * @fileoverview Browse the WHO GHO indicator catalog with pagination.
 * @module mcp-server/tools/definitions/who-list-indicators
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';
import { getGhoService } from '@/services/gho/gho-service.js';
import { applyReadLimit, readLimitSchema } from '@/utils/read-limit.js';

export const whoListIndicators = tool('who_list_indicators', {
  title: 'List WHO GHO Indicators',
  description:
    'Browse the WHO Global Health Observatory indicator catalog with pagination. Use when you want to explore indicators without a keyword, or to page through the full catalog. Use who_search_indicators when you have a keyword to narrow the results.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    limit: readLimitSchema(500)
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
  }),

  // Agent-facing pagination context: catalog total and whether more pages exist.
  // Lives in enrichment so it reaches both structuredContent and content[] alike.
  enrichment: {
    notice: z
      .string()
      .optional()
      .describe('Requested and applied limit when the page was clamped.'),
    totalCount: z.number().describe('Total number of indicators in the GHO catalog.'),
    hasMore: z.boolean().describe('True when more indicators exist beyond the current page.'),
    pageInfo: z
      .string()
      .describe(
        'Human-readable page position, e.g. "offset 0, showing 50 of 3102". Use to construct the next offset.',
      ),
  },

  async handler(input, ctx) {
    const { limit, notice } = applyReadLimit(input.limit, 500, 'who_list_indicators', ctx);
    ctx.log.info('Listing indicators', { limit: input.limit, offset: input.offset });
    const { indicators, total } = await getGhoService().listIndicators(
      { limit, offset: input.offset },
      ctx,
    );
    const hasMore = input.offset + indicators.length < total;
    ctx.enrich.total(total);
    if (notice) ctx.enrich.notice(notice);
    ctx.enrich({
      hasMore,
      pageInfo: `offset ${input.offset}, showing ${indicators.length} of ${total}`,
    });
    return { indicators };
  },

  format: (result) => {
    const lines = [`**Indicators (showing ${result.indicators.length}):**`, ''];
    for (const ind of result.indicators) {
      lines.push(
        `- **${escapeMarkdownInline(ind.indicatorCode)}**: ${escapeMarkdownInline(ind.indicatorName)}`,
      );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
