/**
 * @fileoverview Caller-path coverage for a malformed path identifier (#18). Every
 * definition that reaches one of GhoService's two URL path segments must fail fast with
 * the declared reason and a recovery hint naming its own field; the definitions that
 * only reach query values must still call the upstream. Runs the real service against a
 * stubbed upstream, so the whole definition → handler → service → URL path is exercised.
 * @module tests/integration/malformed-identifier.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import {
  whoDimensionValuesByParentResource,
  whoDimensionValuesPageResource,
  whoDimensionValuesResource,
} from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import { whoIndicatorMetadataResource } from '@/mcp-server/resources/definitions/who-indicator-metadata.resource.js';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

/** A legal JavaScript string with no UTF-8 encoding — `encodeURIComponent` throws on it. */
const LONE_SURROGATE = '\uD800';

/** Every collection answers empty: these cases assert reachability, not payload shape. */
const upstream = useGhoUpstream({
  match: (request) => request.url.startsWith(BASE),
  respond: () => odata([], 0),
});

/** Error envelope of a tool contract run, on both surfaces the clients read. */
const errorSurfaces = (result: Awaited<ReturnType<typeof runToolContract>>) => ({
  error: result.structuredContent?.error as
    | { code?: number; message?: string; data?: Record<string, unknown> }
    | undefined,
  text: (result.content?.[0] as { text?: string } | undefined)?.text ?? '',
});

describe('malformed path identifier — tool paths', () => {
  it('fails who_query_indicator_data with the declared reason on both surfaces', async () => {
    const before = upstream.calls.length;
    const result = await runToolContract(whoQueryIndicatorData, {
      indicator_code: LONE_SURROGATE,
    });
    const { error, text } = errorSurfaces(result);

    expect(result.isError).toBe(true);
    expect(error?.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(error?.data?.reason).toBe('malformed_identifier');
    expect((error?.data?.recovery as { hint?: string } | undefined)?.hint).toContain(
      'indicator_code',
    );
    // content[] is the surface format()-only clients read — the hint has to reach it too.
    expect(text).toMatch(/^Error:/);
    expect(text).toContain('Recovery:');
    expect(text).toContain('indicator_code');
    // An unencodable code never becomes a URL, so nothing is sent upstream.
    expect(upstream.calls.length).toBe(before);
  });

  it('fails who_list_dimension_values with the declared reason on both surfaces', async () => {
    const before = upstream.calls.length;
    const result = await runToolContract(whoListDimensionValues, { dimension: LONE_SURROGATE });
    const { error, text } = errorSurfaces(result);

    expect(result.isError).toBe(true);
    expect(error?.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(error?.data?.reason).toBe('malformed_identifier');
    expect((error?.data?.recovery as { hint?: string } | undefined)?.hint).toContain('dimension');
    expect(text).toMatch(/^Error:/);
    expect(text).toContain('Recovery:');
    expect(text).toContain('dimension');
    expect(upstream.calls.length).toBe(before);
  });
});

describe('malformed path identifier — resource paths', () => {
  it.each([
    [
      'who://dimension/{dimensionCode}/values',
      () =>
        whoDimensionValuesResource.handler(
          whoDimensionValuesResource.params!.parse({ dimensionCode: LONE_SURROGATE }),
          createMockContext(),
        ),
    ],
    [
      'who://dimension/{dimensionCode}/values{?limit,offset}',
      () =>
        whoDimensionValuesPageResource.handler(
          whoDimensionValuesPageResource.params!.parse({
            dimensionCode: LONE_SURROGATE,
            limit: 100,
            offset: 0,
          }),
          createMockContext(),
        ),
    ],
    [
      'who://dimension/{dimensionCode}/values{?limit,offset,parentCode}',
      () =>
        whoDimensionValuesByParentResource.handler(
          whoDimensionValuesByParentResource.params!.parse({
            dimensionCode: LONE_SURROGATE,
            limit: 100,
            offset: 0,
            parentCode: 'EUR',
          }),
          createMockContext(),
        ),
    ],
  ])('fails %s with the declared reason and hint', async (_uri, read) => {
    const before = upstream.calls.length;

    await expect(read()).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'malformed_identifier',
        field: 'dimensionCode',
        recovery: { hint: expect.stringContaining('dimensionCode') },
      },
    });
    expect(upstream.calls.length).toBe(before);
  });
});

describe('indicator metadata paths reach only query values', () => {
  it('sends who_get_indicator_metadata upstream rather than rejecting the code', async () => {
    const before = upstream.calls.length;
    const result = await runToolContract(whoGetIndicatorMetadata, {
      indicator_codes: [LONE_SURROGATE],
    });
    const { error } = errorSurfaces(result);

    // The code reaches the upstream through `$filter`, which encodes an unpaired
    // surrogate rather than throwing — the failure is a plain absent-code result.
    expect(upstream.calls.length).toBeGreaterThan(before);
    expect(error?.data?.reason).toBe('all_not_found');
  });

  it('sends who://indicator/{indicatorCode}/metadata upstream rather than rejecting the code', async () => {
    const before = upstream.calls.length;
    const params = whoIndicatorMetadataResource.params!.parse({
      indicatorCode: LONE_SURROGATE,
    });

    await expect(
      whoIndicatorMetadataResource.handler(params, createMockContext()),
    ).rejects.toMatchObject({ code: JsonRpcErrorCode.NotFound });
    expect(upstream.calls.length).toBeGreaterThan(before);
  });
});
