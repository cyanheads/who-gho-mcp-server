/**
 * @fileoverview Property-based fuzz coverage for the tools whose input space is
 * combinatorial — spatial/temporal/dimension filter shapes, paging, and free-text
 * literals that reach an OData query string. Runs offline against a permissive
 * stubbed upstream, so the generated inputs exercise query construction rather than
 * the network. Seeds are pinned: a failure here reproduces on the next run.
 * @module tests/fuzz/who-tools.fuzz.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  type FetchMockHarness,
} from '@cyanheads/mcp-ts-core/testing';
import { ADVERSARIAL_STRINGS, fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
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
 * The generated phases above cannot reach a URL-path defect on their own: fast-check's
 * string arbitrary emits printable ASCII, and the adversarial phase records leaks rather
 * than crashes, so a raw throw escaping the handler leaves all four green. The corpus is
 * therefore driven directly at the two inputs that become a URL path segment, where
 * `encodeURIComponent` rejects an unpaired UTF-16 surrogate (#18).
 *
 * Runs every corpus string that the input schema accepts, and requires each rejection to
 * be a well-formed MCP error rather than a raw throw.
 */
const survivesCorpus = async (
  run: (value: string) => Promise<'skipped' | undefined>,
): Promise<void> => {
  let reached = 0;
  for (const candidate of ADVERSARIAL_STRINGS) {
    let rejection: unknown;
    let skipped = false;
    try {
      skipped = (await run(candidate)) === 'skipped';
    } catch (error) {
      rejection = error;
    }
    if (skipped) continue;
    reached++;
    if (rejection !== undefined) {
      expect(rejection, `adversarial input ${JSON.stringify(candidate)}`).toBeInstanceOf(McpError);
    }
  }
  // A schema change that rejected the whole corpus would leave the loop asserting nothing.
  expect(reached).toBeGreaterThan(0);
};

it('answers every adversarial who_query_indicator_data indicator_code with an MCP error', async () => {
  await survivesCorpus(async (value) => {
    const parsed = whoQueryIndicatorData.input.safeParse({ indicator_code: value });
    if (!parsed.success) return 'skipped';
    const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
    await whoQueryIndicatorData.handler(parsed.data, ctx);
    return;
  });
});

it('answers every adversarial who_list_dimension_values dimension with an MCP error', async () => {
  await survivesCorpus(async (value) => {
    const parsed = whoListDimensionValues.input.safeParse({ dimension: value });
    if (!parsed.success) return 'skipped';
    const ctx = createMockContext({ errors: whoListDimensionValues.errors });
    await whoListDimensionValues.handler(parsed.data, ctx);
    return;
  });
});

/**
 * The corpus member that reaches the defect, asserted by name so the lane names the
 * contract it is protecting rather than only rejecting a raw throw.
 */
it.each([
  [
    'who_query_indicator_data',
    async () => {
      const ctx = createMockContext({ errors: whoQueryIndicatorData.errors });
      return whoQueryIndicatorData.handler(
        whoQueryIndicatorData.input.parse({ indicator_code: '\uD800' }),
        ctx,
      );
    },
  ],
  [
    'who_list_dimension_values',
    async () => {
      const ctx = createMockContext({ errors: whoListDimensionValues.errors });
      return whoListDimensionValues.handler(
        whoListDimensionValues.input.parse({ dimension: '\uD800' }),
        ctx,
      );
    },
  ],
])('fails %s on the corpus lone surrogate with the declared reason', async (_name, run) => {
  await expect(run()).rejects.toMatchObject({ data: { reason: 'malformed_identifier' } });
});

/**
 * Guards the lane against going vacuous: most generated inputs are rejected by the
 * input schema and never reach a handler, so a change that stopped any of them from
 * reaching the service would leave four green tests asserting nothing.
 */
it('drove generated inputs all the way through to the upstream boundary', () => {
  expect(upstream.calls.length).toBeGreaterThan(0);
});
