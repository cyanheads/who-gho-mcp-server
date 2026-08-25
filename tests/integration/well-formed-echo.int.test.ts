/**
 * @fileoverview Response-boundary coverage for caller strings echoed back into a frame
 * (#19). Every definition that puts a caller-supplied string into output, enrichment, or
 * failure data must emit a frame a strict JSON reader can decode, and must leave a
 * correctly paired non-BMP character untouched. Runs the real service against a stubbed
 * upstream, so the whole definition → handler → service → response path is exercised.
 * @module tests/integration/well-formed-echo.int.test
 */

import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { whoDimensionValuesByParentResource } from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import { whoIndicatorMetadataResource } from '@/mcp-server/resources/definitions/who-indicator-metadata.resource.js';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';
import {
  ASTRAL,
  errorFrame,
  expectWellFormedFrame,
  LONE_SURROGATE,
  REPLACEMENT,
} from '../serialized-frame.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

/** One catalog entry, served whenever a test wants a resolvable indicator. */
const INDICATOR = {
  IndicatorCode: 'WHOSIS_000001',
  IndicatorName: 'Life expectancy at birth (years)',
};

/** One dimension row, served whenever a test wants a code to resolve. */
const DIMENSION_ROW = { Dimension: 'COUNTRY', DimensionName: 'Country' };

/** One data row, served whenever a test wants who_query_indicator_data to succeed. */
const DATA_ROW = {
  IndicatorCode: 'WHOSIS_000001',
  SpatialDimType: 'COUNTRY',
  SpatialDim: 'JPN',
  TimeDim: 2021,
  Dim1Type: 'SEX',
  Dim1: 'SEX_BTSX',
  NumericValue: 84.5,
  Value: '84.5',
};

/** Swapped per test; the installed route delegates here so each case owns its upstream. */
let respond: (request: Request) => Response = () => odata([], 0);

useGhoUpstream({
  match: (request) => request.url.startsWith(BASE),
  respond: (request) => respond(request),
});

/** Serves nothing for every collection — the shape that drives the empty-result paths. */
const servesNothing = () => {
  respond = () => odata([], 0);
};

describe('who_search_indicators echoes the query', () => {
  it('repairs an unpaired surrogate in the success enrichment', async () => {
    respond = () => odata([INDICATOR], 2);

    const result = await runToolContract(whoSearchIndicators, {
      query: `malaria${LONE_SURROGATE}`,
      limit: 1,
    });

    expect(result.isError).toBeFalsy();
    expectWellFormedFrame(result, 'who_search_indicators success frame');
    expect((result.structuredContent as { effectiveQuery?: string }).effectiveQuery).toBe(
      `malaria${REPLACEMENT}`,
    );
  });

  it('repairs an unpaired surrogate in the past-the-end notice', async () => {
    respond = () => odata([], 2);

    const result = await runToolContract(whoSearchIndicators, {
      query: `malaria${LONE_SURROGATE}`,
      offset: 5,
    });

    expect(result.isError).toBeFalsy();
    expectWellFormedFrame(result, 'who_search_indicators past-the-end frame');
    expect((result.structuredContent as { notice?: string }).notice).toContain(
      `malaria${REPLACEMENT}`,
    );
  });

  it('repairs an unpaired surrogate in the no_results failure', async () => {
    servesNothing();

    const result = await runToolContract(whoSearchIndicators, {
      query: `malaria${LONE_SURROGATE}`,
    });

    expect(result.isError).toBe(true);
    expectWellFormedFrame(result, 'who_search_indicators no_results frame');
  });

  it('leaves a paired astral character in the query byte-identical', async () => {
    respond = () => odata([INDICATOR], 1);

    const result = await runToolContract(whoSearchIndicators, { query: `malaria${ASTRAL}` });

    const frame = expectWellFormedFrame(result, 'who_search_indicators astral frame');
    expect((result.structuredContent as { effectiveQuery?: string }).effectiveQuery).toBe(
      `malaria${ASTRAL}`,
    );
    expect(frame).toContain(ASTRAL);
  });
});

describe('who_get_indicator_metadata echoes the requested codes', () => {
  it('repairs an unpaired surrogate in the notFound array of a successful call', async () => {
    respond = (request) =>
      request.url.includes('WHOSIS_000001')
        ? odata(request.url.includes('/IndicatorDimension') ? [DIMENSION_ROW] : [INDICATOR])
        : odata([], 0);

    const result = await runToolContract(whoGetIndicatorMetadata, {
      indicator_codes: ['WHOSIS_000001', LONE_SURROGATE],
    });

    expect(result.isError).toBeFalsy();
    expectWellFormedFrame(result, 'who_get_indicator_metadata partial-match frame');
    expect((result.structuredContent as { notFound?: string[] }).notFound).toEqual([REPLACEMENT]);
  });

  it('repairs an unpaired surrogate in the all_not_found failure data', async () => {
    servesNothing();

    const result = await runToolContract(whoGetIndicatorMetadata, {
      indicator_codes: [LONE_SURROGATE],
    });

    expect(result.isError).toBe(true);
    expectWellFormedFrame(result, 'who_get_indicator_metadata all_not_found frame');
  });

  it('leaves a paired astral character in an unresolved code byte-identical', async () => {
    respond = (request) =>
      request.url.includes('WHOSIS_000001')
        ? odata(request.url.includes('/IndicatorDimension') ? [DIMENSION_ROW] : [INDICATOR])
        : odata([], 0);

    const result = await runToolContract(whoGetIndicatorMetadata, {
      indicator_codes: ['WHOSIS_000001', ASTRAL],
    });

    expect((result.structuredContent as { notFound?: string[] }).notFound).toEqual([ASTRAL]);
    expect(expectWellFormedFrame(result, 'who_get_indicator_metadata astral frame')).toContain(
      ASTRAL,
    );
  });
});

describe('who_list_dimension_values echoes the parent filter', () => {
  it('repairs an unpaired surrogate in the empty-filter notice', async () => {
    servesNothing();

    const result = await runToolContract(whoListDimensionValues, {
      dimension: 'COUNTRY',
      parent_code: LONE_SURROGATE,
    });

    expect(result.isError).toBeFalsy();
    expectWellFormedFrame(result, 'who_list_dimension_values parent-filter frame');
    expect((result.structuredContent as { notice?: string }).notice).toContain(REPLACEMENT);
  });

  it('leaves a paired astral character in the parent filter byte-identical', async () => {
    servesNothing();

    const result = await runToolContract(whoListDimensionValues, {
      dimension: 'COUNTRY',
      parent_code: ASTRAL,
    });

    const frame = expectWellFormedFrame(result, 'who_list_dimension_values astral frame');
    expect((result.structuredContent as { notice?: string }).notice).toContain(ASTRAL);
    expect(frame).toContain(ASTRAL);
  });
});

describe('who_query_indicator_data echoes the applied filters', () => {
  it('repairs an unpaired surrogate in the spatial filter echo', async () => {
    respond = () => odata([DATA_ROW], 1);

    const result = await runToolContract(whoQueryIndicatorData, {
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN', LONE_SURROGATE],
    });

    expect(result.isError).toBeFalsy();
    expectWellFormedFrame(result, 'who_query_indicator_data spatial-filter frame');
    expect(
      (result.structuredContent as { appliedFilters?: { spatialFilter?: string } }).appliedFilters
        ?.spatialFilter,
    ).toBe(`country_codes: JPN,${REPLACEMENT}`);
  });

  it('repairs an unpaired surrogate in a dim1_value the sex filter overrode', async () => {
    respond = () => odata([DATA_ROW], 1);

    const result = await runToolContract(whoQueryIndicatorData, {
      indicator_code: 'WHOSIS_000001',
      sex: 'SEX_BTSX',
      dim1_value: LONE_SURROGATE,
    });

    expect(result.isError).toBeFalsy();
    expectWellFormedFrame(result, 'who_query_indicator_data dim1_value frame');
    expect(
      (result.structuredContent as { appliedFilters?: { dim1Value?: string } }).appliedFilters
        ?.dim1Value,
    ).toBe(REPLACEMENT);
  });

  it('leaves a paired astral character in the spatial filter byte-identical', async () => {
    respond = () => odata([DATA_ROW], 1);

    const result = await runToolContract(whoQueryIndicatorData, {
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN', ASTRAL],
    });

    const frame = expectWellFormedFrame(result, 'who_query_indicator_data astral frame');
    expect(
      (result.structuredContent as { appliedFilters?: { spatialFilter?: string } }).appliedFilters
        ?.spatialFilter,
    ).toBe(`country_codes: JPN,${ASTRAL}`);
    expect(frame).toContain(ASTRAL);
  });
});

describe('who://indicator/{indicatorCode}/metadata echoes the code', () => {
  it('repairs an unpaired surrogate in the resource payload', async () => {
    respond = (request) =>
      odata(request.url.includes('/IndicatorDimension') ? [DIMENSION_ROW] : [], 0);

    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: LONE_SURROGATE });
    const result = await whoIndicatorMetadataResource.handler(params, createMockContext());

    expectWellFormedFrame(result, 'who://indicator metadata payload');
    expect(result).toMatchObject({
      indicatorCode: REPLACEMENT,
      indicatorName: REPLACEMENT,
    });
  });

  it('repairs an unpaired surrogate in the not-found failure', async () => {
    servesNothing();

    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: LONE_SURROGATE });
    // A resource handler may be declared sync, so its return type is not always a
    // Promise — go through Promise.resolve rather than chaining .catch on the call.
    const error = await Promise.resolve(
      whoIndicatorMetadataResource.handler(params, createMockContext()),
    ).catch((err: unknown) => err);

    expectWellFormedFrame(errorFrame(error), 'who://indicator metadata not-found frame');
  });

  it('leaves a paired astral character in the resource payload byte-identical', async () => {
    respond = (request) =>
      odata(request.url.includes('/IndicatorDimension') ? [DIMENSION_ROW] : [], 0);

    const params = whoIndicatorMetadataResource.params!.parse({ indicatorCode: ASTRAL });
    const result = await whoIndicatorMetadataResource.handler(params, createMockContext());

    expect(result).toMatchObject({ indicatorCode: ASTRAL, indicatorName: ASTRAL });
  });
});

describe('who://dimension/{dimensionCode}/values echoes the parent filter', () => {
  it('repairs an unpaired surrogate in the empty-filter notice', async () => {
    servesNothing();

    const params = whoDimensionValuesByParentResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: 100,
      offset: 0,
      parentCode: LONE_SURROGATE,
    });
    const result = await whoDimensionValuesByParentResource.handler(params, createMockContext());

    expectWellFormedFrame(result, 'who://dimension values parent-filter payload');
    expect(result.notice).toContain(REPLACEMENT);
  });

  it('leaves a paired astral character in the parent filter byte-identical', async () => {
    servesNothing();

    const params = whoDimensionValuesByParentResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: 100,
      offset: 0,
      parentCode: ASTRAL,
    });
    const result = await whoDimensionValuesByParentResource.handler(params, createMockContext());

    expect(result.notice).toContain(ASTRAL);
  });
});
