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
    'If results are truncated, refine the query or use who_list_indicators to browse by offset.',
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
    notice: z
      .string()
      .optional()
      .describe(
        'Present when the limit was reached and more results exist. Suggests how to get additional results.',
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
    ctx.log.info('Searching indicators', { query: input.query, limit: input.limit });
    const { indicators, total } = await getGhoService().listIndicators(
      { query: input.query, limit: input.limit, offset: 0 },
      ctx,
    );
    if (indicators.length === 0) {
      throw ctx.fail('no_results', `No indicators matched "${input.query}".`, {
        ...ctx.recoveryFor('no_results'),
      });
    }
    const truncated = total > input.limit;
    ctx.enrich.echo(input.query);
    ctx.enrich.total(total);
    if (truncated) {
      ctx.enrich.notice(
        `Showing ${input.limit} of ${total} matches. Refine the query or increase the limit (max 100) to get more targeted results.`,
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
