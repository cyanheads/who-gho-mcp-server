/**
 * @fileoverview List valid values for a WHO GHO dimension type.
 * @module mcp-server/tools/definitions/who-list-dimension-values
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';
import { wellFormed } from '@/utils/well-formed.js';

export const whoListDimensionValues = tool('who_list_dimension_values', {
  title: 'List GHO Dimension Values',
  description:
    'List valid codes and labels for a WHO GHO dimension type such as COUNTRY, REGION, SEX, ' +
    'WORLDBANKINCOMEGROUP, or AGEGROUP. Use this to discover valid filter values before calling ' +
    'who_query_indicator_data, or to confirm the correct ISO code for a country. ' +
    'Use who_list_dimensions to discover all available dimension type codes. ' +
    'Results are paged in a deterministic order — narrow hierarchical dimensions with parent_code ' +
    '(e.g. the countries in one WHO region), and page the rest with offset.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    dimension: z
      .string()
      .min(1)
      .describe(
        'Dimension type code. Use who_list_dimensions to discover all available codes. ' +
          'Common values: COUNTRY, REGION, SEX, WORLDBANKINCOMEGROUP, AGEGROUP.',
      ),
    parent_code: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Restrict results to values under one parent, e.g. dimension="COUNTRY" with ' +
          'parent_code="EUR" for the countries in the WHO European Region. ' +
          'Only hierarchical dimensions carry a parent; a filter that matches nothing returns ' +
          'an empty page, not an error.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe('Number of values to return per page. Default 100, max 500.'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset into the values for this dimension and filter. Default 0. Read ' +
          'hasMore and nextOffset from the response to continue paging. An offset at or beyond ' +
          'totalCount returns an empty values array, not an error.',
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
      .describe('Valid values for this dimension type, for the requested page.'),
  }),

  // Agent-facing pagination context: the unpaged total, this page's position, and the
  // offset to request next. Lives in enrichment so it reaches structuredContent and
  // content[] alike without a format() entry.
  enrichment: {
    totalCount: z
      .number()
      .describe('Total values for this dimension and filter, before the limit is applied.'),
    offset: z.number().describe('Zero-based offset this page started at.'),
    hasMore: z
      .boolean()
      .describe('True when more values remain beyond this page. Pair with nextOffset to continue.'),
    pageInfo: z
      .string()
      .describe(
        'Human-readable page position, e.g. "offset 0, showing 100 of 234". Use to construct the next offset.',
      ),
    nextOffset: z
      .number()
      .optional()
      .describe(
        'Offset to request for the next page. Absent when this page reached the end of the values.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Present when values were withheld, the parent_code filter matched nothing, or the requested offset ran past the end. Explains what to do next.',
      ),
  },

  errors: [
    {
      reason: 'dimension_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'An unfiltered lookup of the dimension code returned no values at all — it does not exist in the GHO catalog.',
      recovery:
        'Use who_list_dimensions to discover valid dimension type codes and retry with a correct code.',
    },
    {
      reason: 'malformed_identifier',
      code: JsonRpcErrorCode.ValidationError,
      when: 'dimension carries an unpaired UTF-16 surrogate, so it cannot be encoded into the request URL.',
      recovery:
        'Re-send dimension as text with no unpaired UTF-16 surrogate — dimension type codes are ASCII letters and digits, and who_list_dimensions returns valid ones.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching dimension values', {
      dimension: input.dimension,
      limit: input.limit,
      offset: input.offset,
      filtered: input.parent_code != null,
    });
    // Echo copies for the response. `dimension` reaches a URL path segment, where the
    // service refuses an unpaired surrogate outright, so only `parent_code` can carry
    // one this far — both are repaired so the echo boundary holds without depending on
    // which upstream route a value happens to take.
    const echoedDimension = wellFormed(input.dimension);
    const echoedParentCode = input.parent_code ? wellFormed(input.parent_code) : undefined;
    const { values, total } = await getGhoService()
      .listDimensionValues(
        {
          dimensionCode: input.dimension,
          limit: input.limit,
          offset: input.offset,
          ...(input.parent_code && { parentCode: input.parent_code }),
        },
        ctx,
      )
      .catch((err: unknown) => {
        // Re-fail with the typed contract reason so the recovery hint names the input
        // field. The rejected code is left out of the failure data on purpose: it is
        // the caller's own unpaired surrogate, and echoing it puts it back on the wire.
        const reason = (err as { data?: { reason?: string } } | null)?.data?.reason;
        if (reason === 'malformed_identifier') {
          throw ctx.fail(
            'malformed_identifier',
            'The dimension value cannot be encoded into a request URL — it contains an unpaired UTF-16 surrogate.',
            ctx.recoveryFor('malformed_identifier'),
          );
        }
        throw err;
      });

    // The upstream answers an unknown dimension and a filter that matched nothing
    // identically — HTTP 200 with an empty array — so only an unfiltered empty result
    // may claim the dimension does not exist. Paging past the end is a third case: it
    // matched `total` values and asked for a slice beyond them.
    if (total === 0 && !input.parent_code) {
      throw ctx.fail(
        'dimension_not_found',
        `Dimension "${echoedDimension}" returned no values — it does not exist in the GHO catalog.`,
        ctx.recoveryFor('dimension_not_found'),
      );
    }

    const nextOffset = input.offset + values.length;
    const hasMore = nextOffset < total;
    const pastEnd = total > 0 && input.offset >= total;

    ctx.enrich.total(total);
    ctx.enrich({
      offset: input.offset,
      hasMore,
      pageInfo: `offset ${input.offset}, showing ${values.length} of ${total}`,
      ...(hasMore && { nextOffset }),
    });

    // `notice` is last-wins — compose the applicable segment and write it once.
    if (pastEnd) {
      ctx.enrich.notice(
        `Offset ${input.offset} is at or beyond the ${total} values matching this request; ` +
          `the last reachable offset is ${total - 1}.`,
      );
    } else if (total === 0) {
      ctx.enrich.notice(
        `No values in dimension "${echoedDimension}" have parent_code "${echoedParentCode}". ` +
          'The dimension exists; the filter matched nothing. Drop parent_code to list every ' +
          'value, or use who_list_dimension_values on the parent dimension to find a valid code.',
      );
    } else if (hasMore) {
      ctx.enrich.notice(
        `Showing ${values.length} of ${total} values (offset ${input.offset}). ` +
          `Request offset ${nextOffset} for the next page, raise the limit (max 500), ` +
          'or narrow the results with parent_code.',
      );
    }

    return { dimension: echoedDimension, values };
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
