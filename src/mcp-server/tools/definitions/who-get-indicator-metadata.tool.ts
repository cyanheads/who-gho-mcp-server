/**
 * @fileoverview Fetch dimension metadata for one or more WHO GHO indicator codes.
 * @module mcp-server/tools/definitions/who-get-indicator-metadata
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import { getGhoService } from '@/services/gho/gho-service.js';
import { applyReadLimit } from '@/utils/read-limit.js';
import { wellFormed } from '@/utils/well-formed.js';

export const whoGetIndicatorMetadata = tool('who_get_indicator_metadata', {
  title: 'Get WHO GHO Indicator Metadata',
  description:
    'Fetch metadata for WHO GHO indicator codes: the canonical code, full name, and supported dimensions (e.g. COUNTRY, REGION, SEX, YEAR, WORLDBANKINCOMEGROUP, AGEGROUP). Call this before who_query_indicator_data to confirm valid filter dimensions. Processes the first 10 entries and returns unprocessedCodes to submit next, accepting at most 1000 raw entries. With GHO_CLAMP_LIMITS=false, calls above 10 reject. Many valid indicators have no dimension listing upstream — those return an empty dimensions array with dimensionsNote. Processed codes absent from both the catalog and dimension table appear in notFound. No found entries raises all_not_found only when no unprocessed entries remain.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    indicator_codes: z
      .array(z.string().min(1))
      .min(1)
      .max(getServerConfig().clampLimits ? 1000 : 10)
      .describe(
        'Indicator codes, e.g. ["WHOSIS_000001", "MDG_0000000026"]. Processes the first ten and returns remaining entries for the next call; at most 1000 entries.',
      ),
  }),
  output: z.object({
    unprocessedCodes: z
      .array(z.string())
      .optional()
      .describe('Remaining request entries in their original order. Submit these codes next.'),
    indicators: z
      .array(
        z
          .object({
            indicatorCode: z
              .string()
              .describe(
                'Canonical catalog code when resolved; otherwise the requested dimension-only code.',
              ),
            indicatorName: z
              .string()
              .describe(
                'Decoded catalog name; the code itself when only dimension metadata resolves.',
              ),
            dimensions: z
              .array(
                z
                  .object({
                    dimension: z
                      .string()
                      .describe(
                        'Dimension type code, e.g. "COUNTRY", "SEX", "WORLDBANKINCOMEGROUP".',
                      ),
                    dimensionName: z
                      .string()
                      .describe('Human-readable dimension name, e.g. "Country", "Sex".'),
                  })
                  .describe('A dimension entry supported by this indicator.'),
              )
              .describe(
                'Dimensions this indicator supports for filtering in who_query_indicator_data. Empty when the GHO dimension table lists none for this code — see dimensionsNote.',
              ),
            dimensionsNote: z
              .string()
              .optional()
              .describe(
                'Present only when dimensions is empty: explains that the listing is missing upstream rather than the indicator being absent, and how to recover the dimensions from a sample data row.',
              ),
          })
          .describe('Metadata for one indicator.'),
      )
      .describe('Metadata for each code that resolved to a catalog entry or dimension rows.'),
    notFound: z
      .array(z.string())
      .describe(
        'Indicator codes that resolved to neither a catalog name nor any dimension rows — they do not exist in the GHO catalog.',
      ),
  }),

  errors: [
    {
      reason: 'all_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No processed indicator code resolved and no unprocessed codes remain.',
      recovery:
        'Use who_search_indicators to find valid indicator codes matching your topic and retry.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching indicator metadata', { codes: input.indicator_codes });

    const { limit } = applyReadLimit(
      input.indicator_codes.length,
      10,
      'who_get_indicator_metadata',
      ctx,
    );
    const processedCodes = input.indicator_codes.slice(0, limit);
    const unprocessedCodes = input.indicator_codes.slice(limit).map(wellFormed);
    const result = await getGhoService().getIndicatorMetadata(processedCodes, ctx);
    if (result.indicators.length === 0 && unprocessedCodes.length === 0) {
      throw ctx.fail(
        'all_not_found',
        'None of the requested indicator codes resolved to a GHO catalog entry.',
        { codes: input.indicator_codes.map(wellFormed) },
      );
    }

    return { ...result, ...(unprocessedCodes.length > 0 && { unprocessedCodes }) };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const ind of result.indicators) {
      lines.push(
        `**${escapeMarkdownInline(ind.indicatorCode)}:** ${escapeMarkdownInline(ind.indicatorName)}`,
      );
      lines.push(
        ind.dimensions.length > 0
          ? `**Dimensions:** ${ind.dimensions.map((d) => `${escapeMarkdownInline(d.dimension)} (${escapeMarkdownInline(d.dimensionName)})`).join(', ')}`
          : '**Dimensions:** none listed',
      );
      if (ind.dimensionsNote !== undefined)
        lines.push(`**dimensionsNote:** ${escapeMarkdownInline(ind.dimensionsNote)}`);
      lines.push('');
    }
    if (result.notFound.length > 0) {
      lines.push(`**Not found:** ${result.notFound.map(escapeMarkdownInline).join(', ')}`);
    }
    if (result.unprocessedCodes !== undefined) {
      lines.push(
        `**Unprocessed codes:** ${result.unprocessedCodes.map(escapeMarkdownInline).join(', ')}. Submit these codes next; only the first 10 entries were processed.`,
      );
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
