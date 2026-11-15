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
      .describe(
        'Zero-based offset into the catalog. Default 0. Read hasMore and nextOffset from the response to continue paging. An offset at or beyond totalCount returns an empty indicators array, not an error.',
      ),
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

  // Agent-facing pagination context: catalog total, page position, and how to continue.
  // Lives in enrichment so it reaches both structuredContent and content[] alike.
  enrichment: {
    totalCount: z.number().describe('Total number of indicators in the GHO catalog.'),
    offset: z.number().describe('Zero-based offset this page started at.'),
    hasMore: z
      .boolean()
      .describe(
        'True when more indicators remain beyond this page. Pair with nextOffset to continue.',
      ),
    pageInfo: z
      .string()
      .describe(
        'Human-readable page position, in the form "offset {offset}, showing {returned} of {totalCount}". Use to construct the next offset.',
      ),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'Offset to request for the next page. Absent when this page reached the end of the catalog.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Present when the requested limit was clamped, indicators remain beyond this page, or the requested offset ran past the end of the catalog. Explains how to reach the remaining indicators.',
      ),
  },

  enrichmentTrailer: {
    notice: { render: (value: string) => escapeMarkdownInline(value) },
  },

  async handler(input, ctx) {
    const { limit, notice: clampNotice } = applyReadLimit(
      input.limit,
      500,
      'who_list_indicators',
      ctx,
    );
    ctx.log.info('Listing indicators', { limit: input.limit, offset: input.offset });
    const { indicators, total } = await getGhoService().listIndicators(
      { limit, offset: input.offset },
      ctx,
    );

    const nextOffset = input.offset + indicators.length;
    const hasMore = nextOffset < total;
    const pastEnd = total > 0 && input.offset >= total;

    ctx.enrich.total(total);
    ctx.enrich({
      offset: input.offset,
      hasMore,
      pageInfo: `offset ${input.offset}, showing ${indicators.length} of ${total}`,
      ...(hasMore && { nextOffset }),
    });

    // `notice` is last-wins — compose the applicable segment and write it once.
    const notices = clampNotice ? [clampNotice] : [];
    if (pastEnd) {
      notices.push(
        `Offset ${input.offset} is at or beyond the ${total} indicators in the catalog; the last reachable offset is ${total - 1}.`,
      );
    } else if (hasMore) {
      notices.push(
        `Showing ${indicators.length} of ${total} indicators (offset ${input.offset}). Request offset ${nextOffset} for the next page, raise the limit (max 500), or use who_search_indicators to narrow by keyword.`,
      );
    }
    if (notices.length) ctx.enrich.notice(notices.join(' '));
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
