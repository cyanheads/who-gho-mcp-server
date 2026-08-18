/**
 * @fileoverview Property-based fuzz coverage for the tools whose input space is
 * combinatorial — spatial/temporal/dimension filter shapes, paging, and free-text
 * literals that reach an OData query string. Runs offline against a permissive
 * stubbed upstream, so the generated inputs exercise query construction rather than
 * the network. Seeds are pinned: a failure here reproduces on the next run.
 * @module tests/fuzz/who-tools.fuzz.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  createFetchMock,
  createInMemoryStorage,
  type FetchMockHarness,
} from '@cyanheads/mcp-ts-core/testing';
import { fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';
import { initGhoService } from '@/services/gho/gho-service.js';

/** Bounded so the lane stays well inside its 15s timeout and never varies run to run. */
const FUZZ = { numRuns: 50, numAdversarial: 30, timeout: 2_000 } as const;

/**
 * Every upstream collection the tools read, answered non-empty so the generated
 * inputs reach the full success path (query construction, normalization, enrichment)
 * instead of short-circuiting on the empty-result contract errors.
 */
const ENVELOPES: readonly (readonly [string, unknown[]])[] = [
  [
    '/IndicatorDimension',
    [
      { Dimension: 'COUNTRY', DimensionName: 'Country' },
      { Dimension: 'SEX', DimensionName: 'Sex' },
    ],
  ],
  [
    '/Indicator?',
    [{ IndicatorCode: 'WHOSIS_000001', IndicatorName: 'Life expectancy at birth (years)' }],
  ],
  [
    '/DimensionValues',
    [{ Code: 'JPN', Title: 'Japan', ParentCode: 'WPR', ParentTitle: 'Western Pacific' }],
  ],
];

/** Data rows, served for any path that is not one of the named collections above. */
const DATA_ROWS = [
  {
    IndicatorCode: 'WHOSIS_000001',
    SpatialDimType: 'COUNTRY',
    SpatialDim: 'JPN',
    TimeDim: 2021,
    ParentLocation: 'Western Pacific',
    ParentLocationCode: 'WPR',
    Dim1Type: 'SEX',
    Dim1: 'SEX_BTSX',
    NumericValue: 84.5,
    Value: '84.5',
    Low: 84.1,
    High: 84.9,
  },
];

let upstream: FetchMockHarness;

beforeAll(() => {
  upstream = createFetchMock([
    {
      match: () => true,
      respond: (request) => {
        const value = ENVELOPES.find(([marker]) => request.url.includes(marker))?.[1] ?? DATA_ROWS;
        return Response.json({ '@odata.count': value.length, value });
      },
    },
  ]);
  upstream.install();
  initGhoService({} as AppConfig, createInMemoryStorage());
});

afterAll(() => {
  upstream.restore();
});

it('keeps who_query_indicator_data safe across generated filter combinations', async () => {
  const report = await fuzzTool(whoQueryIndicatorData, { ...FUZZ, seed: 20_260_818 });

  expect(report.crashes).toHaveLength(0);
  expect(report.leaks).toHaveLength(0);
  expect(report.prototypePollution).toBe(false);
});

it('keeps who_list_dimension_values safe across generated paging and parent filters', async () => {
  const report = await fuzzTool(whoListDimensionValues, { ...FUZZ, seed: 20_260_819 });

  expect(report.crashes).toHaveLength(0);
  expect(report.leaks).toHaveLength(0);
  expect(report.prototypePollution).toBe(false);
});

it('keeps who_search_indicators safe across generated keywords and offsets', async () => {
  const report = await fuzzTool(whoSearchIndicators, { ...FUZZ, seed: 20_260_820 });

  expect(report.crashes).toHaveLength(0);
  expect(report.leaks).toHaveLength(0);
  expect(report.prototypePollution).toBe(false);
});

it('keeps who_get_indicator_metadata safe across generated code batches', async () => {
  const report = await fuzzTool(whoGetIndicatorMetadata, { ...FUZZ, seed: 20_260_821 });

  expect(report.crashes).toHaveLength(0);
  expect(report.leaks).toHaveLength(0);
  expect(report.prototypePollution).toBe(false);
});

/**
 * Guards the lane against going vacuous: most generated inputs are rejected by the
 * input schema and never reach a handler, so a change that stopped any of them from
 * reaching the service would leave four green tests asserting nothing.
 */
it('drove generated inputs all the way through to the upstream boundary', () => {
  expect(upstream.calls.length).toBeGreaterThan(0);
});
