/**
 * @fileoverview Tool-contract coverage for who_get_indicator_metadata — the parallel
 * catalog-name and dimension-table fan-out, the internal-dimension filter, and the
 * separation of "no dimensions listed upstream" from "code absent from the catalog".
 * @module tests/integration/who-get-indicator-metadata.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect, it } from 'vitest';
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
  GB_XPD_RSDV: 'R&amp;D expenditure',
  imr: 'Infant mortality rate',
};

/** The code inside an `X eq 'CODE'` OData equality filter. */
const filteredCode = (url: URL): string =>
  /eq '([^']*)'/.exec(url.searchParams.get('$filter') ?? '')?.[1] ?? '';

const upstream = useGhoUpstream(
  {
    match: (request) => request.url.startsWith(`${BASE}/IndicatorDimension?`),
    respond: (request) => odata(DIMENSIONS[filteredCode(new URL(request.url))] ?? []),
  },
  {
    match: (request) => request.url.startsWith(`${BASE}/Indicator?`),
    respond: (request) => {
      const code = filteredCode(new URL(request.url));
      const canonical = Object.keys(NAMES).find((key) => key.toLowerCase() === code.toLowerCase());
      return odata(
        canonical ? [{ IndicatorCode: canonical, IndicatorName: NAMES[canonical] }] : [],
      );
    },
  },
);

it('never fetches or classifies continuation entries, even when the processed prefix is all missing', async () => {
  const missing = Array.from({ length: 10 }, (_, i) => `MISSING_${i}`);
  const before = upstream.calls.length;
  const result = await runToolContract(whoGetIndicatorMetadata, {
    indicator_codes: [...missing, 'WHOSIS_000001', 'MISSING_0', 'WHOSIS_000001'],
  });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    indicators: [],
    notFound: missing,
    unprocessedCodes: ['WHOSIS_000001', 'MISSING_0', 'WHOSIS_000001'],
  });
  expect(JSON.stringify(result.content)).toContain('WHOSIS');
  expect(JSON.stringify(result.content)).toContain('Submit these codes next');
  const requests = upstream.calls.slice(before);
  expect(requests.length).toBeGreaterThan(0);
  for (const { request } of requests) expect(request.url).not.toContain('WHOSIS_000001');
});

it('returns the eleventh distinct code in continuation without fetching it', async () => {
  const codes = [
    'WHOSIS_000001',
    ...Array.from({ length: 9 }, (_, i) => `ABSENT_${i}`),
    'MDG_0000000026',
  ];
  const before = upstream.calls.length;
  const result = await runToolContract(whoGetIndicatorMetadata, { indicator_codes: codes });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    unprocessedCodes: ['MDG_0000000026'],
    notFound: codes.slice(1, 10),
  });
  expect(JSON.stringify(result.content)).toContain('MDG');
  const requests = upstream.calls.slice(before);
  for (const { request } of requests) expect(request.url).not.toContain('MDG_0000000026');
  // Cached catalog entries may avoid a request, but each requested prefix position is resolved.
  expect((result.structuredContent as { indicators: unknown[] }).indicators).toHaveLength(1);
});

toolContractSuite(whoGetIndicatorMetadata, {
  success: [
    {
      name: 'canonicalizes case variants while preserving lowercase catalog codes and missing echoes',
      input: { indicator_codes: ['whosis_000001', 'IMR', 'missing'] },
      expected: {
        indicators: [
          {
            indicatorCode: 'WHOSIS_000001',
            indicatorName: 'Life expectancy at birth (years)',
            dimensions: [],
          },
          { indicatorCode: 'imr', indicatorName: 'Infant mortality rate', dimensions: [] },
        ],
        notFound: ['missing'],
      },
      assert: (result) => {
        expect(JSON.stringify(result.content)).toContain('WHOSIS_000001');
        expect(JSON.stringify(result.content)).toContain('Infant mortality rate');
        expect(JSON.stringify(result.content)).toContain('missing');
      },
    },
    {
      name: 'decodes catalog entities exactly once for both response surfaces',
      input: { indicator_codes: ['gb_xpd_rsdv'] },
      expected: {
        indicators: [
          { indicatorCode: 'GB_XPD_RSDV', indicatorName: 'R&D expenditure', dimensions: [] },
        ],
        notFound: [],
      },
      assert: (result) => expect(JSON.stringify(result.content)).toContain('R&D expenditure'),
    },
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
