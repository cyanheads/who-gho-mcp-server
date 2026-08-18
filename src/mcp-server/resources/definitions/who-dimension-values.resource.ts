/**
 * @fileoverview WHO GHO dimension values resource — one page of valid values for a
 * dimension type, addressed by URI. Registered as three URI shapes: the bare default
 * page, an explicitly paged page, and a paged page narrowed to a parent code.
 * @module mcp-server/resources/definitions/who-dimension-values
 */

import { type Context, resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getGhoService } from '@/services/gho/gho-service.js';
import { wellFormed } from '@/utils/well-formed.js';

/** Page size applied when the URI carries no explicit limit. Matches the tool's default. */
const DEFAULT_LIMIT = 100;

const dimensionCodeParam = z
  .string()
  .describe('Dimension type code, e.g. "COUNTRY", "REGION", "SEX", "WORLDBANKINCOMEGROUP".');

/** URI template variables arrive as strings, so numeric ones are coerced. */
const limitParam = z.coerce
  .number()
  .int()
  .min(1)
  .max(500)
  .describe('Number of values to return for this page, 1–500.');

const offsetParam = z.coerce
  .number()
  .int()
  .min(0)
  .describe('Zero-based offset into the values for this dimension and filter.');

const parentCodeParam = z
  .string()
  .min(1)
  .describe('Parent value code to filter on, e.g. "EUR" for countries in the WHO European Region.');

const outputSchema = z.object({
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
    .describe('Valid values for the dimension, for the requested page.'),
  totalCount: z
    .number()
    .describe('Total values for this dimension and filter, before the limit is applied.'),
  offset: z.number().describe('Zero-based offset this page started at.'),
  hasMore: z.boolean().describe('True when more values remain beyond this page.'),
  nextOffset: z
    .number()
    .optional()
    .describe('Offset to request next. Absent when this page reached the end of the values.'),
  notice: z
    .string()
    .optional()
    .describe(
      'Present when values were withheld, the parent filter matched nothing, or the offset ran past the end.',
    ),
});

/**
 * Reads one page of dimension values, separating the three empty-result causes the
 * upstream reports identically (HTTP 200 with an empty array): an unknown dimension,
 * a filter that matched nothing, and an offset past the end of a non-empty set.
 */
async function readPage(
  params: { dimensionCode: string; limit: number; offset: number; parentCode?: string },
  ctx: Context,
): Promise<z.infer<typeof outputSchema>> {
  const { values, total } = await getGhoService().listDimensionValues(params, ctx);

  // Echo copies for the payload. `dimensionCode` reaches a URL path segment, where the
  // service refuses an unpaired surrogate outright, so only `parentCode` can carry one
  // this far — both are repaired so the echo boundary holds without depending on which
  // upstream route a value happens to take.
  const echoedDimension = wellFormed(params.dimensionCode);
  const echoedParent = params.parentCode ? wellFormed(params.parentCode) : undefined;

  if (total === 0 && !params.parentCode) {
    throw notFound(
      `Dimension "${echoedDimension}" returned no values — it does not exist in the GHO catalog. Use who_list_dimensions to discover valid codes.`,
      { dimensionCode: echoedDimension },
    );
  }

  const nextOffset = params.offset + values.length;
  const hasMore = nextOffset < total;
  const pastEnd = total > 0 && params.offset >= total;

  let notice: string | undefined;
  if (pastEnd) {
    notice =
      `Offset ${params.offset} is at or beyond the ${total} values matching this request; ` +
      `the last reachable offset is ${total - 1}.`;
  } else if (total === 0) {
    notice =
      `No values in dimension "${echoedDimension}" have parentCode "${echoedParent}". ` +
      'The dimension exists; the filter matched nothing. Read the unfiltered URI to list every value.';
  } else if (hasMore) {
    notice =
      `Showing ${values.length} of ${total} values (offset ${params.offset}). ` +
      `Read the same URI with offset ${nextOffset} for the next page.`;
  }

  return {
    dimension: echoedDimension,
    values,
    totalCount: total,
    offset: params.offset,
    hasMore,
    ...(hasMore && { nextOffset }),
    ...(notice && { notice }),
  };
}

const sharedDescription =
  'One page of valid values for a WHO GHO dimension type, in a deterministic order. ' +
  'Useful as injectable context when building queries with who_query_indicator_data. ' +
  'Use who_list_dimensions to discover valid dimension type codes.';

export const whoDimensionValuesResource = resource('who://dimension/{dimensionCode}/values', {
  name: 'who-dimension-values',
  description: `${sharedDescription} Returns the first ${DEFAULT_LIMIT} values; read totalCount and nextOffset to reach the rest.`,
  mimeType: 'application/json',
  params: z.object({ dimensionCode: dimensionCodeParam }),
  output: outputSchema,
  handler: (params, ctx) =>
    readPage({ dimensionCode: params.dimensionCode, limit: DEFAULT_LIMIT, offset: 0 }, ctx),
});

/**
 * The SDK's RFC 6570 matcher compiles every query variable into a required, ordered
 * capture group, so one template with optional variables cannot serve both the bare and
 * the paged URI. Each shape is registered separately; the regexes are disjoint.
 */
export const whoDimensionValuesPageResource = resource(
  'who://dimension/{dimensionCode}/values{?limit,offset}',
  {
    name: 'who-dimension-values-page',
    description: `${sharedDescription} Both limit and offset must be present in the URI.`,
    mimeType: 'application/json',
    params: z.object({
      dimensionCode: dimensionCodeParam,
      limit: limitParam,
      offset: offsetParam,
    }),
    output: outputSchema,
    handler: readPage,
  },
);

export const whoDimensionValuesByParentResource = resource(
  'who://dimension/{dimensionCode}/values{?limit,offset,parentCode}',
  {
    name: 'who-dimension-values-by-parent',
    description: `${sharedDescription} Narrowed to one parent code; limit, offset, and parentCode must all be present in the URI. A filter that matches nothing returns an empty page, not an error.`,
    mimeType: 'application/json',
    params: z.object({
      dimensionCode: dimensionCodeParam,
      limit: limitParam,
      offset: offsetParam,
      parentCode: parentCodeParam,
    }),
    output: outputSchema,
    handler: readPage,
  },
);
