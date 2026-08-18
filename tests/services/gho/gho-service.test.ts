/**
 * @fileoverview Service-level tests for GhoService — the real OData query-string
 * construction and the withRetry/defaultIsTransient interaction, exercised against
 * a stubbed upstream. Every other test in this repo mocks getGhoService() wholesale
 * and therefore never sees the request this service actually builds.
 * @module tests/services/gho/gho-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  type FetchMockHarness,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
type ServiceError = { message?: string; data?: Record<string, unknown> };

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
      // These are the 4xx codes the fail-fast change must NOT capture: codeOverride
      // returns undefined below 500 so they reach the framework's transient mapping
      // (RateLimited / Timeout). Widening codeOverride to the whole 4xx range would
      // break rate-limit handling while every other test here stayed green.
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

  it.each([500, 501, 502, 503])(
    'retries HTTP %i from queryData four times and classifies it by status',
    async (status) => {
      const error = await queryStatus(status);

      expect(http.calls).toHaveLength(4);
      expect(error?.message).toContain(`HTTP ${status}`);
    },
  );

  it.each([429, 408])(
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
