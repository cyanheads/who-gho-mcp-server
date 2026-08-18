/**
 * @fileoverview Tool-contract coverage for who_get_indicator_metadata — the parallel
 * catalog-name and dimension-table fan-out, the internal-dimension filter, and the
 * separation of "no dimensions listed upstream" from "code absent from the catalog".
 * @module tests/integration/who-get-indicator-metadata.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

/** Codes the IndicatorDimension table has rows for. PUBLISHSTATE is an internal state. */
const DIMENSIONS: Record<string, { Dimension: string; DimensionName: string }[]> = {
  WHOSIS_000001: [
    { Dimension: 'COUNTRY', DimensionName: 'Country' },
    { Dimension: 'SEX', DimensionName: 'Sex' },
    { Dimension: 'PUBLISHSTATE', DimensionName: 'Publish State' },
  ],
};

/** Codes the Indicator catalog names. MDG_0000000026 is named but has no dimension rows. */
const NAMES: Record<string, string> = {
  WHOSIS_000001: 'Life expectancy at birth (years)',
  MDG_0000000026: 'Prevalence of tuberculosis',
};

/** The code inside an `X eq 'CODE'` OData equality filter. */
const filteredCode = (url: URL): string =>
  /eq '([^']*)'/.exec(url.searchParams.get('$filter') ?? '')?.[1] ?? '';

useGhoUpstream(
  {
    match: (request) => request.url.startsWith(`${BASE}/IndicatorDimension?`),
    respond: (request) => odata(DIMENSIONS[filteredCode(new URL(request.url))] ?? []),
  },
  {
    match: (request) => request.url.startsWith(`${BASE}/Indicator?`),
    respond: (request) => {
      const code = filteredCode(new URL(request.url));
      const name = NAMES[code];
      return odata(name ? [{ IndicatorCode: code, IndicatorName: name }] : []);
    },
  },
);

toolContractSuite(whoGetIndicatorMetadata, {
  success: [
    {
      name: 'returns the catalog name and filters the internal publishing dimension out',
      input: { indicator_codes: ['WHOSIS_000001'] },
      expected: {
        indicators: [
          {
            indicatorCode: 'WHOSIS_000001',
            indicatorName: 'Life expectancy at birth (years)',
            dimensions: [
              { dimension: 'COUNTRY', dimensionName: 'Country' },
              { dimension: 'SEX', dimensionName: 'Sex' },
            ],
          },
        ],
        notFound: [],
      },
      assert: (result) => {
        const dimensions = (
          result.structuredContent as { indicators: { dimensions: { dimension: string }[] }[] }
        ).indicators[0]?.dimensions;
        expect(dimensions?.map((d) => d.dimension)).not.toContain('PUBLISHSTATE');
      },
    },
    {
      name: 'notes a named code the dimension table lists nothing for instead of calling it missing',
      input: { indicator_codes: ['MDG_0000000026'] },
      expected: {
        indicators: [
          {
            indicatorCode: 'MDG_0000000026',
            indicatorName: 'Prevalence of tuberculosis',
            dimensions: [],
          },
        ],
        notFound: [],
      },
      assert: (result) => {
        const note = (result.structuredContent as { indicators: { dimensionsNote?: string }[] })
          .indicators[0]?.dimensionsNote;
        expect(note).toContain('who_query_indicator_data');
      },
    },
    {
      name: 'reports an absent code alongside the ones that resolved',
      input: { indicator_codes: ['WHOSIS_000001', 'NOT_A_CODE'] },
      expected: { notFound: ['NOT_A_CODE'] },
      assert: (result) => {
        expect((result.structuredContent as { indicators: unknown[] }).indicators).toHaveLength(1);
      },
    },
  ],
  errors: [
    {
      name: 'reports a call where no code resolved to a catalog entry',
      input: { indicator_codes: ['NOT_A_CODE', 'ALSO_NOT_A_CODE'] },
      code: JsonRpcErrorCode.NotFound,
      reason: 'all_not_found',
    },
  ],
});
