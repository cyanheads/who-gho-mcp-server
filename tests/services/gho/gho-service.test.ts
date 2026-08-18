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
