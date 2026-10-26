/**
 * @fileoverview Service-level tests for GhoService — the real OData query-string
 * construction and the withRetry/defaultIsTransient interaction, exercised against
 * a stubbed upstream. Every other test in this repo mocks getGhoService() wholesale
 * and therefore never sees the request this service actually builds.
 * @module tests/services/gho/gho-service.test
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  type FetchMockHarness,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeIndicatorName } from '@/services/gho/decode-indicator-name.js';
import { GhoService } from '@/services/gho/gho-service.js';

const BASE = 'https://ghoapi.azureedge.net/api';

const newService = () => new GhoService({} as AppConfig, createInMemoryStorage());

/** Query params of the nth captured upstream request. */
const paramsOf = (http: FetchMockHarness, index = 0): URLSearchParams =>
  new URL(http.calls[index]!.request.url).searchParams;

const dataRow = {
  IndicatorCode: 'WHOSIS_000001',
  SpatialDimType: 'COUNTRY',
  SpatialDim: 'JPN',
  TimeDim: 2021,
  NumericValue: 84.5,
  Value: '84.5',
};

const countryDataRow = {
  ...dataRow,
  ParentLocation: 'Western Pacific',
  ParentLocationCode: 'WPR',
};

const regionDataRow = {
  IndicatorCode: 'WHOSIS_000001',
  SpatialDimType: 'REGION',
  SpatialDim: 'EUR',
  TimeDim: 2021,
  NumericValue: 79.3,
  Value: '79.3',
  ParentLocation: null,
  ParentLocationCode: null,
};

const countryValue = {
  Code: 'JPN',
  Title: 'Japan',
  ParentCode: 'WPR',
  ParentTitle: 'Western Pacific',
  ParentDimension: 'REGION',
};

/**
 * A lone high surrogate — a legal JavaScript string with no UTF-8 encoding, so
 * `encodeURIComponent` throws `URIError` on it. Only the two identifiers that reach a
 * URL path segment are exposed to that; `URLSearchParams` substitutes U+FFFD instead.
 */
const LONE_SURROGATE = '\uD800';

const DESC_ORDER = 'TimeDim desc,SpatialDim,Dim1,Id';
const ASC_ORDER = 'TimeDim asc,SpatialDim,Dim1,Id';

const baseQueryParams = {
  indicatorCode: 'WHOSIS_000001',
  includeUncertainty: false,
  limit: 200,
  offset: 0,
  orderBy: DESC_ORDER,
};

/** The rejection the service throws: message plus the structured `data` payload. */
type ServiceError = { code?: number; message?: string; data?: Record<string, unknown> };

/**
 * Drives withRetry's backoff sleeps to completion under fake timers, returning the
 * rejection — `undefined` when the call resolved instead.
 */
const settle = async (promise: Promise<unknown>): Promise<ServiceError | undefined> => {
  const caught = promise.then(
    () => undefined,
    (error: unknown) => error as ServiceError,
  );
  await vi.runAllTimersAsync();
  return caught;
};

/** The OData envelope the live API returns for a rejected query (verified HTTP 400). */
const odataRejection = () =>
  Response.json(
    {
      error: {
        code: '',
        message:
          "The query specified in the URI is not valid. Invalid JSON. A comma character ',' was expected in scope 'Array'.",
      },
    },
    { status: 400 },
  );

/**
 * The diagnostic the live API returns for a malformed `$filter` (verified HTTP 400).
 * Its message text is the error quality an early `!response.ok` check would discard.
 */
const odataFilterRejection = () =>
  Response.json(
    {
      error: {
        code: '',
        message: "There is an unterminated literal at position 20 in 'SpatialDim eq 'J'PN''.",
      },
    },
    { status: 400 },
  );

describe('GhoService — request construction', () => {
  let http: FetchMockHarness;

  beforeEach(() => {
    http = createFetchMock();
    http.install();
  });

  afterEach(() => {
    http.restore();
  });

  it('keeps exact-code lookup independent of names and preserves an empty past-end page', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/Indicator?`),
      respond: () => Response.json({ '@odata.count': 1, value: [] }),
    });
    const result = await newService().listIndicators(
      { indicatorCode: "ODD'CODE", query: 'ignored name', limit: 1, offset: 2 },
      createMockContext(),
    );
    expect(result).toEqual({ indicators: [], total: 1 });
    expect(paramsOf(http).get('$filter')).toBe("IndicatorCode eq 'ODD''CODE'");
    expect(paramsOf(http).get('$skip')).toBe('2');
    expect(http.calls).toHaveLength(1);
  });

  it('queryData sends $top, $count, and $select against the indicator-data endpoint', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 1, value: [dataRow] }),
    });

    const result = await newService().queryData(baseQueryParams, createMockContext());

    expect(result.rows).toHaveLength(1);
    expect(result.totalRows).toBe(1);

    const params = paramsOf(http);
    expect(params.get('$top')).toBe('200');
    expect(params.get('$count')).toBe('true');
    expect(params.get('$select')).toContain('NumericValue');
  });

  it('queryData selects both parent-location fields (#15)', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 1, value: [countryDataRow] }),
    });

    await newService().queryData(baseQueryParams, createMockContext());

    const select = paramsOf(http).get('$select')!.split(',');
    // $select is a whitelist: a field missing here never reaches normalizeRow at all.
    expect(select).toContain('ParentLocation');
    expect(select).toContain('ParentLocationCode');
  });

  it('queryData names the parent region fields for what they hold (#15)', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 1, value: [countryDataRow] }),
    });

    const result = await newService().queryData(baseQueryParams, createMockContext());

    expect(result.rows[0]).toMatchObject({
      spatialDim: 'JPN',
      parentLocation: 'Western Pacific',
      parentLocationCode: 'WPR',
    });
    // spatialLabel read as a name for the row's own entity while holding its parent's.
    expect(result.rows[0]).not.toHaveProperty('spatialLabel');
  });

  it('queryData omits both parent fields on a region row rather than emitting nulls (#15)', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 1, value: [regionDataRow] }),
    });

    const result = await newService().queryData(baseQueryParams, createMockContext());

    // Upstream serves null for both on a row whose spatial dimension is itself a region.
    expect(result.rows[0]).toMatchObject({ spatialDim: 'EUR', spatialDimType: 'REGION' });
    expect(result.rows[0]).not.toHaveProperty('parentLocation');
    expect(result.rows[0]).not.toHaveProperty('parentLocationCode');
  });

  it('queryData omits both parent fields on an income-group row (#15)', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () =>
        Response.json({
          '@odata.count': 1,
          value: [
            {
              ...regionDataRow,
              SpatialDimType: 'WORLDBANKINCOMEGROUP',
              SpatialDim: 'WB_HI',
            },
          ],
        }),
    });

    const result = await newService().queryData(baseQueryParams, createMockContext());

    expect(result.rows[0]).toMatchObject({ spatialDim: 'WB_HI' });
    expect(result.rows[0]).not.toHaveProperty('parentLocation');
    expect(result.rows[0]).not.toHaveProperty('parentLocationCode');
  });

  it('queryData carries the parent fields per row across a mixed page (#15)', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 2, value: [countryDataRow, regionDataRow] }),
    });

    const result = await newService().queryData(baseQueryParams, createMockContext());

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.parentLocationCode).toBe('WPR');
    expect(result.rows[1]?.parentLocationCode).toBeUndefined();
  });

  it('queryData escapes an apostrophe in a country code by doubling it (closed #3 regression)', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 0, value: [] }),
    });

    await newService().queryData(
      { ...baseQueryParams, countryCodes: ["JPN'"] },
      createMockContext(),
    );

    expect(paramsOf(http).get('$filter')).toBe(
      "SpatialDimType eq 'COUNTRY' and SpatialDim in ('JPN''')",
    );
  });

  it('queryData emits $orderby alongside $skip, terminating in the unique Id tiebreak', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 12936, value: [dataRow] }),
    });

    await newService().queryData({ ...baseQueryParams, offset: 400 }, createMockContext());

    const params = paramsOf(http);
    expect(params.get('$skip')).toBe('400');
    expect(params.get('$orderby')).toBe(DESC_ORDER);
    expect(params.get('$orderby')!.endsWith(',Id')).toBe(true);
  });

  it('queryData emits the ascending ordering when asked for it', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 12936, value: [dataRow] }),
    });

    await newService().queryData({ ...baseQueryParams, orderBy: ASC_ORDER }, createMockContext());

    expect(paramsOf(http).get('$orderby')).toBe(ASC_ORDER);
  });

  it('queryData reports truncation from the page position, not the bare total', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => Response.json({ '@odata.count': 3, value: [dataRow, dataRow] }),
    });

    const result = await newService().queryData(
      { ...baseQueryParams, limit: 2, offset: 1 },
      createMockContext(),
    );

    // offset 1 + 2 rows === 3 total: the page reaches the end, so nothing is truncated,
    // even though totalRows (3) exceeds the limit (2).
    expect(result.truncated).toBe(false);
  });

  it('listIndicators sends $orderby=IndicatorCode whenever $skip is sent', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/Indicator?`),
      respond: () =>
        Response.json({
          '@odata.count': 31,
          value: [{ IndicatorCode: 'CHILDMORT5TO14', IndicatorName: 'Mortality 5-14' }],
        }),
    });

    const result = await newService().listIndicators(
      { query: 'mortality', limit: 2, offset: 2 },
      createMockContext(),
    );

    expect(result.total).toBe(31);
    const params = paramsOf(http);
    expect(params.get('$top')).toBe('2');
    expect(params.get('$skip')).toBe('2');
    expect(params.get('$orderby')).toBe('IndicatorCode');
    expect(params.get('$filter')).toBe("contains(IndicatorName,'mortality')");
  });

  it('listDimensionValues sends $top, $skip, $count, and a total $orderby=Code', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION/COUNTRY/DimensionValues`),
      respond: () => Response.json({ '@odata.count': 234, value: [countryValue] }),
    });

    const result = await newService().listDimensionValues(
      { dimensionCode: 'COUNTRY', limit: 100, offset: 20 },
      createMockContext(),
    );

    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({ code: 'JPN', label: 'Japan', parentCode: 'WPR' });
    expect(result.total).toBe(234);

    const params = paramsOf(http);
    expect(params.get('$top')).toBe('100');
    expect(params.get('$skip')).toBe('20');
    expect(params.get('$count')).toBe('true');
    // Code is unique and non-null across every GHO dimension, so it is a total
    // order — without it $skip pages over an order the upstream never promised.
    expect(params.get('$orderby')).toBe('Code');
    expect(params.get('$filter')).toBeNull();
  });

  it('listDimensionValues sends a ParentCode filter with the apostrophe doubled', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION/COUNTRY/DimensionValues`),
      respond: () => Response.json({ '@odata.count': 0, value: [] }),
    });
    http.route({
      match: `${BASE}/DIMENSION/COUNTRY`,
      respond: () => Response.json({ Code: 'COUNTRY', Title: 'Country' }),
    });

    const result = await newService().listDimensionValues(
      { dimensionCode: 'COUNTRY', limit: 100, offset: 0, parentCode: "EU'R" },
      createMockContext(),
    );

    expect(result).toEqual({ values: [], total: 0 });
    expect(paramsOf(http).get('$filter')).toBe("ParentCode eq 'EU''R'");
  });

  it('listDimensionValues falls back to the page length when the upstream omits @odata.count', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION/SEX/DimensionValues`),
      respond: () => Response.json({ value: [countryValue, countryValue] }),
    });

    const result = await newService().listDimensionValues(
      { dimensionCode: 'SEX', limit: 100, offset: 0 },
      createMockContext(),
    );

    expect(result.total).toBe(2);
  });

  it('getIndicatorDimensions fans out one filtered request per code', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/IndicatorDimension?`),
      respond: () =>
        Response.json({
          value: [
            { Dimension: 'COUNTRY', DimensionName: 'Country', IndicatorCode: 'WHOSIS_000001' },
            { Dimension: 'PUBLISHSTATE', DimensionName: 'Publish State', IndicatorCode: 'X' },
          ],
        }),
    });

    const map = await newService().getIndicatorDimensions(
      ['WHOSIS_000001', "ODD'CODE"],
      createMockContext(),
    );

    expect(http.calls).toHaveLength(2);
    expect(paramsOf(http, 0).get('$filter')).toBe("IndicatorCode eq 'WHOSIS_000001'");
    // Apostrophes are doubled before reaching the upstream filter.
    expect(paramsOf(http, 1).get('$filter')).toBe("IndicatorCode eq 'ODD''CODE'");
    // PUBLISHSTATE is an internal publishing state, never a user-filterable dimension.
    expect(map.get('WHOSIS_000001')).toEqual([{ dimension: 'COUNTRY', dimensionName: 'Country' }]);
  });

  it('getIndicatorDimensions maps a code with only internal rows to an empty array, not absence', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/IndicatorDimension?`),
      respond: () =>
        Response.json({
          value: [
            {
              Dimension: 'PUBLISHSTATE',
              DimensionName: 'Publish State',
              IndicatorCode: 'CHILDMORT10TO19',
            },
          ],
        }),
    });

    const map = await newService().getIndicatorDimensions(['CHILDMORT10TO19'], createMockContext());

    // Absence from the map used to mean "no dimension rows", which callers read as
    // "the indicator does not exist". Every requested code now gets an entry, so the
    // map answers only the dimension question and existence is resolved elsewhere.
    expect(map.has('CHILDMORT10TO19')).toBe(true);
    expect(map.get('CHILDMORT10TO19')).toEqual([]);
  });

  it('getIndicatorDimensions maps a code with no upstream rows at all to an empty array', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/IndicatorDimension?`),
      respond: () => Response.json({ value: [] }),
    });

    const map = await newService().getIndicatorDimensions(
      ['PHE_HHAIR_PROP_POP_CLEAN_FUELS'],
      createMockContext(),
    );

    expect(map.get('PHE_HHAIR_PROP_POP_CLEAN_FUELS')).toEqual([]);
  });

  it('percent-encodes an indicator code into the path segment it occupies', async () => {
    http.route({
      match: (req) => req.url.startsWith(BASE),
      respond: () => Response.json({ '@odata.count': 0, value: [] }),
    });

    await newService().queryData(
      { ...baseQueryParams, indicatorCode: 'A B/C' },
      createMockContext(),
    );

    // The code is a path segment, not a query value: a bare slash would otherwise
    // address a different collection entirely.
    expect(new URL(http.calls[0]!.request.url).pathname).toBe('/api/A%20B%2FC');
  });

  it('percent-encodes a dimension code into the path segment it occupies', async () => {
    http.route({
      match: (req) => req.url.startsWith(BASE),
      respond: () => Response.json({ '@odata.count': 0, value: [] }),
    });

    await newService().listDimensionValues(
      { dimensionCode: 'A B/C', limit: 100, offset: 0 },
      createMockContext(),
    );

    expect(new URL(http.calls[0]!.request.url).pathname).toBe(
      '/api/DIMENSION/A%20B%2FC/DimensionValues',
    );
  });

  it('encodes an astral character in a path identifier rather than rejecting it (#18)', async () => {
    http.route({
      match: (req) => req.url.startsWith(BASE),
      respond: () => Response.json({ '@odata.count': 0, value: [] }),
    });

    // A paired surrogate is well-formed UTF-16 and encodes fine — only an unpaired
    // one is rejected, so the guard must not reach for the whole surrogate range.
    await newService().listDimensionValues(
      { dimensionCode: '\u{1F600}', limit: 100, offset: 0 },
      createMockContext(),
    );

    expect(new URL(http.calls[0]!.request.url).pathname).toBe(
      '/api/DIMENSION/%F0%9F%98%80/DimensionValues',
    );
  });

  it.each([
    [
      'listDimensionValues parentCode',
      (svc: GhoService, ctx: Context) =>
        svc.listDimensionValues(
          { dimensionCode: 'COUNTRY', limit: 100, offset: 0, parentCode: LONE_SURROGATE },
          ctx,
        ),
    ],
    [
      'queryData countryCodes',
      (svc: GhoService, ctx: Context) =>
        svc.queryData({ ...baseQueryParams, countryCodes: [LONE_SURROGATE] }, ctx),
    ],
    [
      'listIndicators indicatorCode',
      (svc: GhoService, ctx: Context) =>
        svc.listIndicators({ indicatorCode: LONE_SURROGATE, limit: 1, offset: 0 }, ctx),
    ],
    [
      'getIndicatorDimensions code',
      (svc: GhoService, ctx: Context) => svc.getIndicatorDimensions([LONE_SURROGATE], ctx),
    ],
  ])(
    'reaches the upstream with a lone surrogate in %s — query values are not path segments (#18)',
    async (_name, call) => {
      http.route({
        match: (req) => req.url.startsWith(BASE),
        respond: () => Response.json({ '@odata.count': 0, value: [] }),
      });

      await call(newService(), createMockContext());

      // URLSearchParams substitutes U+FFFD for an unpaired surrogate instead of
      // throwing, so these fields carry no fail-fast obligation.
      expect(http.calls).toHaveLength(_name === 'listDimensionValues parentCode' ? 2 : 1);
      expect(http.calls[0]!.request.url).toContain('%EF%BF%BD');
    },
  );
});

describe('GhoService — retry classification', () => {
  let http: FetchMockHarness;

  beforeEach(() => {
    http = createFetchMock();
    http.install();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.restore();
  });

  it('fails a rejected OData query on the first attempt', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: odataRejection,
    });

    const error = await settle(
      newService().queryData({ ...baseQueryParams, countryCodes: ["J'PN"] }, createMockContext()),
    );

    expect(error).toBeDefined();
    expect(http.calls).toHaveLength(1);
    expect(error?.data?.reason).toBe('invalid_query');
    expect(error?.data?.retryable).toBe(false);
  });

  it('fails a deterministic 400 from getJson on the first attempt', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION`),
      respond: () => new Response('bad request', { status: 400 }),
    });

    const error = await settle(newService().listDimensions(createMockContext()));

    expect(error).toBeDefined();
    expect(http.calls).toHaveLength(1);
  });

  it.each([429, 408])(
    'still retries HTTP %i from getJson — a throttled or timed-out request is not deterministic',
    async (status) => {
      http.route({
        match: (req) => req.url.startsWith(`${BASE}/DIMENSION`),
        respond: () => new Response('slow down', { status }),
      });

      const error = await settle(newService().listDimensions(createMockContext()));

      expect(error).toBeDefined();
      // These are the 4xx codes the fail-fast path must NOT capture: the framework's
      // status mapping sends them to RateLimited and Timeout, both transient. Widening
      // fail-fast across the whole 4xx range would break rate-limit handling while
      // every other test here stayed green.
      expect(http.calls).toHaveLength(4);
    },
  );

  it.each([500, 502, 503])('still retries HTTP %i from getJson four times', async (status) => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION`),
      respond: () => new Response('upstream trouble', { status }),
    });

    const error = await settle(newService().listDimensions(createMockContext()));

    expect(error).toBeDefined();
    expect(http.calls).toHaveLength(4);
  });

  it('does not retry a 404 from queryData — an unknown indicator code is deterministic', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/NOPE?`),
      respond: () => new Response('not found', { status: 404 }),
    });

    const error = await settle(
      newService().queryData({ ...baseQueryParams, indicatorCode: 'NOPE' }, createMockContext()),
    );

    expect(error).toBeDefined();
    expect(error?.data?.reason).toBe('indicator_not_found');
    expect(http.calls).toHaveLength(1);
  });

  /**
   * queryData reads the body before classifying on status, so none of the getJson
   * request-count assertions above pin any of this — these drive queryData itself.
   */
  const queryStatus = (status: number, body = 'upstream trouble') => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => new Response(body, { status }),
    });
    return settle(newService().queryData(baseQueryParams, createMockContext()));
  };

  it.each([500, 502, 503])(
    'retries HTTP %i from queryData four times and classifies it by status',
    async (status) => {
      const error = await queryStatus(status);

      expect(http.calls).toHaveLength(4);
      expect(error?.message).toContain(`HTTP ${status}`);
    },
  );

  it('fails a 501 from queryData on the first attempt — the method is absent upstream', async () => {
    const error = await queryStatus(501);

    // 501 classifies as ServiceUnavailable like the rest of the 5xx range, so the
    // in-band data.retryable: false the framework attaches is what keeps it out of
    // the retry loop: re-asking for a method the upstream does not implement returns
    // the same answer every time.
    expect(http.calls).toHaveLength(1);
    expect(error?.data?.retryable).toBe(false);
    expect(error?.message).toContain('HTTP 501');
  });

  // 504 rides here rather than with the 5xx group above: the framework maps it to
  // Timeout, not ServiceUnavailable. Both are transient, so the retry count is the
  // same and only the code a client branches on differs.
  it.each([429, 408, 504])(
    'retries HTTP %i from queryData four times — throttled or timed out is not deterministic',
    async (status) => {
      const error = await queryStatus(status, 'slow down');

      expect(http.calls).toHaveLength(4);
      expect(error?.message).toContain(`HTTP ${status}`);
    },
  );

  it('fails a non-JSON deterministic 400 from queryData on the first attempt', async () => {
    const error = await queryStatus(400, 'bad request');

    // The parse failure used to surface as ServiceUnavailable, which is transient —
    // a deterministic 4xx burned the whole retry budget before failing.
    expect(http.calls).toHaveLength(1);
    expect(error?.message).toContain('HTTP 400');
  });

  it('classifies a non-2xx JSON body carrying no error key', async () => {
    const error = await queryStatus(400, JSON.stringify({ notAnEnvelope: true }));

    // Valid JSON with neither `error` nor `value` reached data.value.map() and threw
    // a TypeError, which withRetry treats as transient because it is not an McpError.
    expect(http.calls).toHaveLength(1);
    expect(error?.message).toContain('HTTP 400');
  });

  it('preserves the upstream OData diagnostic for a malformed $filter', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: odataFilterRejection,
    });

    const error = await settle(
      newService().queryData({ ...baseQueryParams, countryCodes: ["J'PN"] }, createMockContext()),
    );

    // A status check placed before the body is read would replace this with a
    // generic HTTP 400 and lose what GHO actually said was wrong.
    expect(error?.message).toContain('There is an unterminated literal at position 20');
    expect(error?.data?.reason).toBe('invalid_query');
    expect(error?.data?.retryable).toBe(false);
    expect(http.calls).toHaveLength(1);
  });
});

describe('GhoService — client-facing errors carry no encoded query string', () => {
  let http: FetchMockHarness;

  beforeEach(() => {
    http = createFetchMock();
    http.install();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.restore();
  });

  it('omits the URL from a rejected-OData-query error', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: odataRejection,
    });

    const error = await settle(newService().queryData(baseQueryParams, createMockContext()));

    expect(error).toBeDefined();
    expect(error?.data?.url).toBeUndefined();
    expect(JSON.stringify(error?.data ?? {})).not.toContain('%24');
    expect(error?.message ?? '').not.toContain(BASE);
  });

  it('omits the URL from a non-2xx getJson error', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION`),
      respond: () => new Response('bad request', { status: 400 }),
    });

    const error = await settle(newService().listDimensions(createMockContext()));

    expect(error).toBeDefined();
    expect(error?.data?.url).toBeUndefined();
    expect(error?.message ?? '').not.toContain(BASE);
  });

  it('omits the URL from a non-2xx queryData error', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/WHOSIS_000001?`),
      respond: () => new Response('bad request', { status: 400 }),
    });

    const error = await settle(newService().queryData(baseQueryParams, createMockContext()));

    expect(error).toBeDefined();
    expect(error?.data?.url).toBeUndefined();
    expect(JSON.stringify(error?.data ?? {})).not.toContain('%24');
    expect(error?.message ?? '').not.toContain(BASE);
  });

  it('omits the URL from a network-failure error', async () => {
    http.route({
      match: (req) => req.url.startsWith(`${BASE}/DIMENSION`),
      respond: () => {
        throw new TypeError('connection reset');
      },
    });

    const error = await settle(newService().listDimensions(createMockContext()));

    expect(error).toBeDefined();
    expect(error?.data?.url).toBeUndefined();
    expect(error?.message ?? '').not.toContain(BASE);
  });
});

describe('GhoService — shared service contracts', () => {
  let http: FetchMockHarness;
  beforeEach(() => {
    http = createFetchMock();
    http.install();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    http.restore();
    vi.unstubAllGlobals();
  });

  it('ANDs independently escaped tokens and groups literal/entity alternatives', async () => {
    http.route({
      match: () => true,
      respond: () =>
        Response.json({
          '@odata.count': 1,
          value: [{ IndicatorCode: 'RD', IndicatorName: 'R&amp;D health' }],
        }),
    });
    const result = await newService().listIndicators(
      { query: "  R&D\t children's  ", limit: 2, offset: 0 },
      createMockContext(),
    );
    expect(paramsOf(http).get('$filter')).toBe(
      "(contains(IndicatorName,'R&D') or contains(IndicatorName,'R&amp;D')) and contains(IndicatorName,'children''s')",
    );
    expect(result.indicators[0]?.indicatorName).toBe('R&D health');
  });

  it('rejects whitespace-only queries before sending an unfiltered request', async () => {
    http.route({ match: () => true, respond: () => Response.json({ value: [] }) });
    const error = await settle(
      newService().listIndicators({ query: ' \t\n', limit: 2, offset: 0 }, createMockContext()),
    );
    expect(error?.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(http.calls).toHaveLength(0);
  });

  it('decodes names exactly once and preserves invalid and unknown references', async () => {
    http.route({
      match: () => true,
      respond: () =>
        Response.json({
          value: [
            {
              IndicatorCode: 'X',
              IndicatorName:
                '&amp;lt; &#8805; &#xb2; &lt;&gt;&quot;&apos; &#0; &#xD800; &#1114112; &unknown; unchanged',
            },
          ],
        }),
    });
    const result = await newService().listIndicators({ limit: 2, offset: 0 }, createMockContext());
    expect(result.indicators[0]?.indicatorName).toBe(
      '&lt; ≥ ² <>"\' &#0; &#xD800; &#1114112; &unknown; unchanged',
    );
  });

  it.each([0, 1, 8])(
    'falls back only on name total zero and preserves offset %i',
    async (offset) => {
      http.route({
        match: () => true,
        respond: (request) => {
          const filter = new URL(request.url).searchParams.get('$filter');
          return Response.json(
            filter?.startsWith('IndicatorCode eq')
              ? {
                  '@odata.count': 1,
                  value:
                    offset === 0
                      ? [{ IndicatorCode: 'imr', IndicatorName: 'Infant mortality' }]
                      : [],
                }
              : { '@odata.count': 0, value: [] },
          );
        },
      });
      const result = await newService().listIndicators(
        { query: 'imr', limit: 2, offset },
        createMockContext(),
      );
      expect(result).toEqual({
        indicators:
          offset === 0 ? [{ indicatorCode: 'imr', indicatorName: 'Infant mortality' }] : [],
        total: 1,
      });
      expect(http.calls).toHaveLength(2);
      expect(paramsOf(http, 1).get('$skip')).toBe(String(offset));
    },
  );

  it('does not replace a name match whose requested page is empty', async () => {
    http.route({
      match: () => true,
      respond: () => Response.json({ '@odata.count': 3, value: [] }),
    });
    expect(
      await newService().listIndicators({ query: 'imr', limit: 2, offset: 8 }, createMockContext()),
    ).toEqual({ indicators: [], total: 3 });
    expect(http.calls).toHaveLength(1);
  });

  it('selects and normalizes independent Dim3 coordinates and escapes optional filters', async () => {
    http.route({
      match: () => true,
      respond: () =>
        Response.json({
          value: [
            { ...dataRow, Dim3Type: 'CHILDCAUSE' },
            { ...dataRow, Dim3: 'CHILDCAUSE_CH9' },
            dataRow,
          ],
        }),
    });
    const result = await newService().queryData(
      { ...baseQueryParams, dim2Value: "AGE'GROUP", dim3Value: "CHILD'CAUSE" },
      createMockContext(),
    );
    expect(paramsOf(http).get('$filter')).toBe("Dim2 eq 'AGE''GROUP' and Dim3 eq 'CHILD''CAUSE'");
    expect(paramsOf(http).get('$select')?.split(',')).toEqual(
      expect.arrayContaining(['Dim3Type', 'Dim3']),
    );
    expect(result.rows[0]).toHaveProperty('dim3Type', 'CHILDCAUSE');
    expect(result.rows[0]).not.toHaveProperty('dim3');
    expect(result.rows[1]).toHaveProperty('dim3', 'CHILDCAUSE_CH9');
    expect(result.rows[1]).not.toHaveProperty('dim3Type');
    expect(result.rows[2]).not.toHaveProperty('dim3');
    expect(paramsOf(http).get('$orderby')).toBe(DESC_ORDER);
  });

  it.each([404, 403, 503])(
    'checks filtered total-zero dimension metadata and preserves status %i',
    async (status) => {
      http.route({
        match: () => true,
        respond: (request) =>
          request.url.includes('/DimensionValues?')
            ? Response.json({ '@odata.count': 0, value: [] })
            : new Response('metadata failure', { status }),
      });
      const error = await settle(
        newService().listDimensionValues(
          { dimensionCode: 'NOT_REAL', parentCode: 'EUR', limit: 2, offset: 0 },
          createMockContext(),
        ),
      );
      expect(error?.code).toBe(
        status === 404
          ? JsonRpcErrorCode.NotFound
          : status === 403
            ? JsonRpcErrorCode.Forbidden
            : JsonRpcErrorCode.ServiceUnavailable,
      );
      expect(error?.data?.reason).toBe(status === 404 ? 'dimension_not_found' : undefined);
      expect(http.calls).toHaveLength(status === 503 ? 8 : 2);
    },
  );

  it('keeps valid filtered empties after metadata verification', async () => {
    http.route({
      match: () => true,
      respond: (request) =>
        Response.json(
          request.url.includes('/DimensionValues?')
            ? { '@odata.count': 0, value: [] }
            : { Code: 'SEX', Title: 'Sex' },
        ),
    });
    expect(
      await newService().listDimensionValues(
        { dimensionCode: 'SEX', parentCode: 'EUR', limit: 2, offset: 0 },
        createMockContext(),
      ),
    ).toEqual({ values: [], total: 0 });
    expect(http.calls).toHaveLength(2);
  });

  it.each([
    { parentCode: undefined, total: 0 },
    { parentCode: 'EUR', total: 2 },
  ])(
    'does not probe dimension existence for $parentCode with total $total',
    async ({ parentCode, total }) => {
      http.route({
        match: () => true,
        respond: () => Response.json({ '@odata.count': total, value: [] }),
      });
      expect(
        await newService().listDimensionValues(
          {
            dimensionCode: 'SEX',
            ...(parentCode !== undefined && { parentCode }),
            limit: 2,
            offset: 8,
          },
          createMockContext(),
        ),
      ).toEqual({ values: [], total });
      expect(http.calls).toHaveLength(1);
    },
  );

  it('keeps exact-code misses empty and escapes the fallback literal', async () => {
    http.route({
      match: () => true,
      respond: () => Response.json({ '@odata.count': 0, value: [] }),
    });
    expect(
      await newService().listIndicators(
        { query: "ODD'CODE", limit: 2, offset: 0 },
        createMockContext(),
      ),
    ).toEqual({ indicators: [], total: 0 });
    expect(paramsOf(http, 1).get('$filter')).toBe("IndicatorCode eq 'ODD''CODE'");
  });

  it('shares the original deadline with the exact-code fallback request', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, options: RequestInit) => {
        const signal = options.signal!;
        signals.push(signal);
        if (signals.length === 1)
          return new Promise<Response>((resolve) =>
            setTimeout(() => resolve(Response.json({ '@odata.count': 0, value: [] })), 20_000),
          );
        return new Promise<Response>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      }),
    );
    const pending = settle(
      newService().listIndicators({ query: 'imr', limit: 1, offset: 0 }, createMockContext()),
    );
    expect((await pending)?.code).toBe(JsonRpcErrorCode.Timeout);
    expect(signals).toHaveLength(2);
    expect(signals[1]).toBe(signals[0]);
  });

  it.each(['before', 'headers', 'backoff'])(
    'classifies caller cancellation %s without retries',
    async (phase) => {
      const caller = new AbortController();
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: unknown, options: RequestInit) => {
          calls++;
          if (phase === 'backoff')
            return Promise.resolve(new Response('unavailable', { status: 503 }));
          const signal = options.signal!;
          return new Promise<Response>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        }),
      );
      if (phase === 'before') caller.abort();
      const pending = newService()
        .listDimensions(createMockContext({ signal: caller.signal }))
        .then(
          () => undefined,
          (err: unknown) => err as ServiceError,
        );
      await vi.advanceTimersByTimeAsync(0);
      caller.abort();
      await vi.runAllTimersAsync();
      expect((await pending)?.code).toBe(JsonRpcErrorCode.RequestCancelled);
      expect(calls).toBe(phase === 'before' ? 0 : 1);
    },
  );

  it('does not wait or retry when Retry-After exceeds the remaining deadline', async () => {
    http.route({
      match: () => true,
      respond: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
        return new Response('limited', { status: 429, headers: { 'Retry-After': '20' } });
      },
    });
    const start = Date.now();
    const error = await settle(newService().listDimensions(createMockContext()));
    expect(error?.code).toBe(JsonRpcErrorCode.RateLimited);
    expect(error?.data?.retryAfter).toBe('20');
    expect(Date.now()).toBe(start + 15_000);
    expect(http.calls).toHaveLength(1);
  });

  it('ends the ladder when another backoff cannot fit the remaining operation budget', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        await new Promise<void>((resolve) => setTimeout(resolve, calls === 1 ? 25_000 : 3_000));
        return new Response('unavailable', { status: 503 });
      }),
    );
    const start = Date.now();
    const error = await settle(newService().listDimensions(createMockContext()));
    expect(error?.code).toBe(JsonRpcErrorCode.Timeout);
    expect(error?.data?.reason).toBe('retry_deadline_exceeded');
    expect(calls).toBe(2);
    expect(Date.now() - start).toBeLessThan(30_000);
  });

  it('resolves canonical metadata and keeps ordered dimension-only and missing echoes', async () => {
    http.route({
      match: () => true,
      respond: (request) => {
        const url = new URL(request.url);
        const filter = url.searchParams.get('$filter') ?? '';
        if (url.pathname.endsWith('/IndicatorDimension'))
          return Response.json({
            value: filter.includes('raw')
              ? [{ Dimension: 'SEX', DimensionName: 'Sex', IndicatorCode: 'raw' }]
              : [],
          });
        return Response.json({
          value: filter.includes("'imr'")
            ? [{ IndicatorCode: 'imr', IndicatorName: 'Infant mortality' }]
            : filter.includes('whosis')
              ? [{ IndicatorCode: 'WHOSIS_000001', IndicatorName: 'Life &amp; health' }]
              : [],
        });
      },
    });
    const result = await newService().getIndicatorMetadata(
      ['whosis_000001', 'raw', LONE_SURROGATE, 'imr'],
      createMockContext(),
    );
    expect(result.indicators.map((entry) => entry.indicatorCode)).toEqual([
      'WHOSIS_000001',
      'raw',
      'imr',
    ]);
    expect(result.indicators[0]?.indicatorName).toBe('Life & health');
    expect(result.indicators[0]?.dimensionsNote).toContain('dim3Type');
    expect(result.indicators[1]).toEqual({
      indicatorCode: 'raw',
      indicatorName: 'raw',
      dimensions: [{ dimension: 'SEX', dimensionName: 'Sex' }],
    });
    expect(result.notFound).toEqual(['�']);
  });

  it.each([
    [401, JsonRpcErrorCode.Unauthorized, 1],
    [403, JsonRpcErrorCode.Forbidden, 1],
    [408, JsonRpcErrorCode.Timeout, 4],
    [429, JsonRpcErrorCode.RateLimited, 4],
    [500, JsonRpcErrorCode.ServiceUnavailable, 4],
    [501, JsonRpcErrorCode.ServiceUnavailable, 1],
    [502, JsonRpcErrorCode.ServiceUnavailable, 4],
    [503, JsonRpcErrorCode.ServiceUnavailable, 4],
    [504, JsonRpcErrorCode.Timeout, 4],
  ])('classifies JSON error envelopes by HTTP %i', async (status, code, attempts) => {
    http.route({
      match: () => true,
      respond: () => Response.json({ error: { message: 'upstream unavailable' } }, { status }),
    });
    const error = await settle(newService().queryData(baseQueryParams, createMockContext()));
    expect(error?.code).toBe(code);
    expect(error?.data?.reason).not.toBe('invalid_query');
    expect(error?.data?.url).toBeUndefined();
    expect(http.calls).toHaveLength(attempts);
  });

  it.each(['query', 'catalog', 'bad-query'])(
    'bounds stalled %s bodies and preserves caller cancellation',
    async (path) => {
      for (const cancel of [false, true]) {
        let suppliedSignal: AbortSignal | undefined;
        let bodyRead = false;
        let calls = 0;
        vi.stubGlobal(
          'fetch',
          vi.fn(async (_url: unknown, options: RequestInit) => {
            calls++;
            suppliedSignal = options.signal!;
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{'));
                  suppliedSignal!.addEventListener(
                    'abort',
                    () => controller.error(suppliedSignal!.reason),
                    { once: true },
                  );
                },
                pull() {
                  bodyRead = true;
                },
              }),
              { status: path === 'bad-query' ? 400 : 200 },
            );
          }),
        );
        const caller = new AbortController();
        const ctx = createMockContext({ signal: caller.signal });
        let settled = false;
        const pending = (
          path === 'catalog'
            ? newService().listDimensions(ctx)
            : newService().queryData(baseQueryParams, ctx)
        )
          .then(
            () => undefined,
            (err: unknown) => err as ServiceError,
          )
          .then((error) => {
            settled = true;
            return error;
          });
        await vi.advanceTimersByTimeAsync(0);
        expect(bodyRead).toBe(true);
        if (cancel) caller.abort();
        await vi.advanceTimersByTimeAsync(30_001);
        expect(suppliedSignal?.aborted).toBe(true);
        expect(settled).toBe(true);
        expect((await pending)?.code).toBe(
          cancel ? JsonRpcErrorCode.RequestCancelled : JsonRpcErrorCode.Timeout,
        );
        expect(calls).toBe(1);
      }
    },
  );
});

describe('indicator-name decoder timing', () => {
  /** Validate each step before allowing the next, larger input. */
  const withinBounds = (samples: number[]) => {
    for (let index = 1; index < samples.length; index++)
      expect(samples[index]! / samples[index - 1]!).toBeLessThan(16);
    expect(samples.at(-1)! / samples[0]!).toBeLessThan(256);
    expect(Math.max(...samples)).toBeLessThan(1_000_000);
  };

  it('rejects a failing control before trusting the timing harness', () => {
    expect(() => withinBounds([1, 8, 64, 512, 4096, 32768, 262144])).toThrow();
  });

  it.each([
    '&',
    '&#',
    '&#x',
    '&amp',
    '&amp;',
    '&#999999',
    '\n&amp',
    '&amp\n',
    ' &#xD800;',
    'numeric',
  ])('scales across 64x input for %j', (prefix) => {
    const samples: number[] = [];
    for (let size = 5_000; size <= 320_000; size *= 2) {
      const input = `${
        prefix === 'numeric'
          ? `&#${'9'.repeat(size)};`
          : prefix.repeat(Math.ceil(size / prefix.length)).slice(0, size)
      }\n`;
      for (let warm = 0; warm < 2; warm++) decodeIndicatorName(input);
      const runs: number[] = [];
      for (let round = 0; round < 3; round++) {
        const before = process.threadCpuUsage();
        for (let repeat = 0; repeat < 3; repeat++) decodeIndicatorName(input);
        const cpu = process.threadCpuUsage(before);
        runs.push(cpu.user + cpu.system);
      }
      samples.push(Math.min(...runs));
      withinBounds(samples);
    }
  });

  it.each(['word', ' \t', '\nword ', 'word\n'])(
    'scales tokenization across 64x input for %j',
    async (prefix) => {
      const samples: number[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ '@odata.count': 1, value: [] })),
      );
      try {
        const svc = newService();
        const ctx = createMockContext();
        for (let size = 5_000; size <= 320_000; size *= 2) {
          const query = `${prefix.repeat(Math.ceil(size / prefix.length)).slice(0, size)}\n`;
          const run = () =>
            svc.listIndicators({ query, limit: 1, offset: 0 }, ctx).catch((error: ServiceError) => {
              if (error.code !== JsonRpcErrorCode.ValidationError) throw error;
            });
          await run();
          const runs: number[] = [];
          for (let round = 0; round < 3; round++) {
            const before = process.threadCpuUsage();
            await run();
            const cpu = process.threadCpuUsage(before);
            runs.push(cpu.user + cpu.system);
          }
          samples.push(Math.min(...runs));
          withinBounds(samples);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});

describe('GhoService — malformed path identifiers (#18)', () => {
  let http: FetchMockHarness;

  beforeEach(() => {
    http = createFetchMock();
    http.install();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.restore();
  });

  /**
   * Settles a call expected to fail without entering the retry budget: flushes the
   * pending microtasks, then asserts no backoff sleep was scheduled. A retried failure
   * parks one here and settles roughly six seconds later.
   */
  const settleWithoutBackoff = async (promise: Promise<unknown>): Promise<ServiceError> => {
    const caught = promise.then(
      () => undefined,
      (error: unknown) => error as ServiceError,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    const error = await caught;
    expect(error).toBeDefined();
    return error as ServiceError;
  };

  const hintOf = (error: ServiceError): string | undefined =>
    (error.data?.recovery as { hint?: string } | undefined)?.hint;

  it.each([
    ['a lone high surrogate', LONE_SURROGATE],
    ['a lone low surrogate', '\uDFFF'],
    ['a lone surrogate inside an otherwise valid code', `WHOSIS${LONE_SURROGATE}000001`],
  ])('queryData fails on %s in one attempt', async (_name, indicatorCode) => {
    const error = await settleWithoutBackoff(
      newService().queryData({ ...baseQueryParams, indicatorCode }, createMockContext()),
    );

    expect(http.calls).toHaveLength(0);
    expect(error.data?.reason).toBe('malformed_identifier');
    expect(error.data?.field).toBe('indicatorCode');
    expect(hintOf(error)).toContain('indicatorCode');
    // withRetry stamps this only when it exhausts the budget.
    expect(error.data?.retryAttempts).toBeUndefined();
    expect(error.message ?? '').not.toMatch(/failed after \d+ attempts/);
  });

  it.each([
    ['a lone high surrogate', LONE_SURROGATE],
    ['a lone low surrogate', '\uDFFF'],
    ['a lone surrogate inside an otherwise valid code', `COUNTRY${LONE_SURROGATE}`],
  ])('listDimensionValues fails on %s in one attempt', async (_name, dimensionCode) => {
    const error = await settleWithoutBackoff(
      newService().listDimensionValues(
        { dimensionCode, limit: 100, offset: 0 },
        createMockContext(),
      ),
    );

    expect(http.calls).toHaveLength(0);
    expect(error.data?.reason).toBe('malformed_identifier');
    expect(error.data?.field).toBe('dimensionCode');
    expect(hintOf(error)).toContain('dimensionCode');
    expect(error.data?.retryAttempts).toBeUndefined();
    expect(error.message ?? '').not.toMatch(/failed after \d+ attempts/);
  });

  it('does not echo the rejected identifier or the upstream base URL', async () => {
    const error = await settleWithoutBackoff(
      newService().queryData(
        { ...baseQueryParams, indicatorCode: LONE_SURROGATE },
        createMockContext(),
      ),
    );

    const serialized = JSON.stringify({ message: error.message, data: error.data });
    expect(serialized).not.toContain('\\ud800');
    expect(serialized).not.toContain(BASE);
  });
});
