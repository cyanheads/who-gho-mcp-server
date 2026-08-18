/**
 * @fileoverview Search the WHO GHO indicator catalog by keyword.
 * @module mcp-server/tools/definitions/who-search-indicators
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';

export const whoSearchIndicators = tool('who_search_indicators', {
  title: 'Search WHO GHO Indicators',
  description:
    'Search the WHO Global Health Observatory indicator catalog by keyword in the indicator name. ' +
    'Returns indicator codes and names for use with who_query_indicator_data. ' +
    'The search uses a substring match on indicator names — try terms like "life expectancy", ' +
    '"immunization", "mortality", "diabetes", or "HIV". ' +
    'If results are truncated, refine the query or page further into the same filtered result set with offset.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe('Keyword to search in indicator names, e.g. "life expectancy" or "tuberculosis".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of indicators to return. Default 20, max 100.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset into the matches for this query. Default 0. Read hasMore and ' +
          'nextOffset from the response to continue paging. An offset at or beyond totalCount ' +
          'returns an empty indicators array, not an error.',
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
      .describe('Matching indicators up to the requested limit.'),
  }),

  // Agent-facing result context: the search term as echoed, total catalog matches, and
  // truncation notice when the limit was reached. Lives in enrichment (not output) so it
  // reaches structuredContent + content[] alike without a format() entry.
  enrichment: {
    effectiveQuery: z
      .string()
      .describe('Keyword used for the catalog search, as received by the server.'),
    totalCount: z
      .number()
      .describe('Total indicators matching the query in the catalog, before the limit is applied.'),
    offset: z.number().describe('Zero-based offset this page started at.'),
    hasMore: z
      .boolean()
      .describe(
        'True when more matches remain beyond this page. Pair with nextOffset to continue.',
      ),
    pageInfo: z
      .string()
      .describe(
        'Human-readable page position, e.g. "offset 0, showing 20 of 3003". Use to construct the next offset.',
      ),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'Offset to request for the next page. Absent when this page reached the end of the matches.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Present when matches were withheld or the requested offset ran past the end of the result set. Explains how to reach the remaining matches.',
      ),
  },

  errors: [
    {
      reason: 'no_results',
      code: JsonRpcErrorCode.NotFound,
      when: 'No indicators matched the query keyword.',
      recovery:
        'Try a different keyword or use who_list_indicators to browse the full catalog without a filter.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching indicators', {
      query: input.query,
      limit: input.limit,
      offset: input.offset,
    });
    const { indicators, total } = await getGhoService().listIndicators(
      { query: input.query, limit: input.limit, offset: input.offset },
      ctx,
    );

    // An empty page has two distinct causes once offset exists. Paging past the end
    // matched `total` indicators and asked for a slice beyond them — "no indicators
    // matched" is false for it, so it returns an empty page rather than an error.
    const pastEnd = total > 0 && input.offset >= total;
    if (indicators.length === 0 && !pastEnd) {
      throw ctx.fail(
        'no_results',
        `No indicators matched "${input.query}".`,
        ctx.recoveryFor('no_results'),
      );
    }

    const nextOffset = input.offset + indicators.length;
    const hasMore = nextOffset < total;

    ctx.enrich.echo(input.query);
    ctx.enrich.total(total);
    ctx.enrich({
      offset: input.offset,
      hasMore,
      pageInfo: `offset ${input.offset}, showing ${indicators.length} of ${total}`,
      ...(hasMore && { nextOffset }),
    });

    // `notice` is last-wins — compose the applicable segment and write it once.
    if (pastEnd) {
      ctx.enrich.notice(
        `Offset ${input.offset} is at or beyond the ${total} indicators matching "${input.query}"; ` +
          `the last reachable offset is ${total - 1}.`,
      );
    } else if (hasMore) {
      ctx.enrich.notice(
        `Showing ${indicators.length} of ${total} matches (offset ${input.offset}). ` +
          `Request offset ${nextOffset} for the next page, raise the limit (max 100), ` +
          'or refine the query for more targeted results.',
      );
    }
    return { indicators };
  },

  format: (result) => {
    const lines = [`**Found indicators (showing ${result.indicators.length}):**`, ''];
    for (const ind of result.indicators) {
      lines.push(`- **${ind.indicatorCode}**: ${ind.indicatorName}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
