/**
 * @fileoverview Tool-contract coverage for who_list_dimension_values — paging, the
 * parent_code filter, and the split between an unknown dimension and a filter that
 * matched nothing (the upstream answers both with HTTP 200 and an empty array).
 * @module tests/integration/who-list-dimension-values.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

const COUNTRIES = [
  {
    Code: 'JPN',
    Title: 'Japan',
    ParentCode: 'WPR',
    ParentTitle: 'Western Pacific',
    ParentDimension: 'REGION',
  },
  {
    Code: 'USA',
    Title: 'United States of America',
    ParentCode: 'AMR',
    ParentTitle: 'Americas',
    ParentDimension: 'REGION',
  },
];

/** Total values upstream reports for COUNTRY, so a first page still has more behind it. */
const TOTAL = 194;

const upstream = useGhoUpstream({
  match: (request) => request.url.startsWith(`${BASE}/DIMENSION/`),
  respond: (request) => {
    const url = new URL(request.url);
    const dimension = decodeURIComponent(url.pathname.split('/').at(-2) ?? '');
    if (dimension !== 'COUNTRY') return odata([], 0);
    // Only EUR is stocked; any other parent filter is a filter that matched nothing.
    const filter = url.searchParams.get('$filter');
    if (filter && !filter.includes("'EUR'")) return odata([], 0);
    const skip = Number(url.searchParams.get('$skip'));
    return odata(skip >= TOTAL ? [] : COUNTRIES, TOTAL);
  },
});

/** Query params of the request the service just emitted. */
const lastQuery = (): URLSearchParams =>
  new URL(upstream.calls[upstream.calls.length - 1]!.request.url).searchParams;

toolContractSuite(whoListDimensionValues, {
  success: [
    {
      name: 'returns a first page of values in a stable order',
      input: { dimension: 'COUNTRY' },
      expected: {
        dimension: 'COUNTRY',
        values: [
          {
            code: 'JPN',
            label: 'Japan',
            parentCode: 'WPR',
            parentLabel: 'Western Pacific',
            parentDimension: 'REGION',
          },
          {
            code: 'USA',
            label: 'United States of America',
            parentCode: 'AMR',
            parentLabel: 'Americas',
            parentDimension: 'REGION',
          },
        ],
      },
      assert: (result) => {
        const query = lastQuery();
        expect(query.get('$orderby')).toBe('Code');
        expect(query.get('$top')).toBe('100');
        expect(query.get('$skip')).toBe('0');
        expect(query.get('$filter')).toBeNull();
        expect(result.structuredContent).toMatchObject({
          totalCount: TOTAL,
          offset: 0,
          hasMore: true,
          nextOffset: 2,
        });
      },
    },
    {
      name: 'narrows to a parent code and emits the ParentCode filter',
      input: { dimension: 'COUNTRY', parent_code: 'EUR', limit: 50, offset: 100 },
      assert: () => {
        const query = lastQuery();
        expect(query.get('$filter')).toBe("ParentCode eq 'EUR'");
        expect(query.get('$top')).toBe('50');
        expect(query.get('$skip')).toBe('100');
      },
    },
    {
      name: 'reports a parent filter that matched nothing as an empty page, not a missing dimension',
      input: { dimension: 'COUNTRY', parent_code: 'ZZZ' },
      expected: { dimension: 'COUNTRY', values: [] },
      assert: (result) => {
        expect(lastQuery().get('$filter')).toBe("ParentCode eq 'ZZZ'");
        expect((result.structuredContent as { notice?: string }).notice).toContain(
          'The dimension exists; the filter matched nothing.',
        );
      },
    },
    {
      name: 'returns an empty page rather than an error when the offset runs past the end',
      input: { dimension: 'COUNTRY', offset: 500 },
      expected: { dimension: 'COUNTRY', values: [] },
      assert: (result) => {
        expect((result.structuredContent as { notice?: string }).notice).toContain('500');
      },
    },
  ],
  errors: [
    {
      name: 'reports an unfiltered dimension lookup that returned nothing at all',
      input: { dimension: 'NOTADIMENSION' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'dimension_not_found',
    },
  ],
});
