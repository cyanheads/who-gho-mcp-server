/**
 * @fileoverview Tool-contract coverage for who_search_indicators — keyword search,
 * paging, and the empty-page-versus-no-results split against a stubbed upstream.
 * @module tests/integration/who-search-indicators.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

const MATCHES = [
  { IndicatorCode: 'WHOSIS_000001', IndicatorName: 'Life expectancy at birth (years)' },
  { IndicatorCode: 'WHOSIS_000002', IndicatorName: 'Healthy life expectancy (HALE) at birth' },
];

/** Total matches upstream reports, so a default-limit page still has more behind it. */
const TOTAL = 25;

const upstream = useGhoUpstream({
  match: (request) => request.url.startsWith(`${BASE}/Indicator?`),
  respond: (request) => {
    const url = new URL(request.url);
    const filter = url.searchParams.get('$filter') ?? '';
    if (filter.includes('nomatch')) return odata([], 0);
    const skip = Number(url.searchParams.get('$skip'));
    return odata(skip >= TOTAL ? [] : MATCHES, TOTAL);
  },
});

/** Query params of the request the service just emitted. */
const lastQuery = (): URLSearchParams =>
  new URL(upstream.calls[upstream.calls.length - 1]!.request.url).searchParams;

toolContractSuite(whoSearchIndicators, {
  success: [
    {
      name: 'returns matches and emits a contains() filter over a stable catalog order',
      input: { query: 'life expectancy' },
      expected: {
        indicators: [
          { indicatorCode: 'WHOSIS_000001', indicatorName: 'Life expectancy at birth (years)' },
          {
            indicatorCode: 'WHOSIS_000002',
            indicatorName: 'Healthy life expectancy (HALE) at birth',
          },
        ],
      },
      assert: (result) => {
        const query = lastQuery();
        expect(query.get('$filter')).toBe("contains(IndicatorName,'life expectancy')");
        expect(query.get('$orderby')).toBe('IndicatorCode');
        expect(query.get('$top')).toBe('20');
        expect(query.get('$skip')).toBe('0');
        expect(result.structuredContent).toMatchObject({
          effectiveQuery: 'life expectancy',
          totalCount: TOTAL,
          hasMore: true,
          nextOffset: 2,
        });
      },
    },
    {
      name: 'doubles apostrophes in the search literal',
      input: { query: "cote d'ivoire" },
      assert: () => {
        expect(lastQuery().get('$filter')).toBe("contains(IndicatorName,'cote d''ivoire')");
      },
    },
    {
      name: 'returns an empty page rather than an error when the offset runs past the end',
      input: { query: 'life expectancy', offset: 99 },
      expected: { indicators: [] },
      assert: (result) => {
        expect(lastQuery().get('$skip')).toBe('99');
        expect((result.structuredContent as { notice?: string }).notice).toContain('99');
      },
    },
  ],
  errors: [
    {
      name: 'reports a keyword that matched no indicators',
      input: { query: 'nomatch' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'no_results',
    },
  ],
});
