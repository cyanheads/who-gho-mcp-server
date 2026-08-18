/**
 * @fileoverview Tests for the who://dimension/{dimensionCode}/values resource family.
 * @module tests/resources/who-dimension-values.resource.test
 */

import { validationError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  whoDimensionValuesByParentResource,
  whoDimensionValuesPageResource,
  whoDimensionValuesResource,
} from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import * as ghoServiceModule from '@/services/gho/gho-service.js';

const mockService = {
  listDimensionValues: vi.fn(),
};

vi.spyOn(ghoServiceModule, 'getGhoService').mockReturnValue(mockService as never);

/** The service returns one page plus the unpaged total. */
const page = <T>(values: T[], total = values.length) => ({ values, total });

describe('whoDimensionValuesResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns values for a known dimension', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([
        { code: 'SEX_BTSX', label: 'Both sexes' },
        { code: 'SEX_FMLE', label: 'Female' },
        { code: 'SEX_MLE', label: 'Male' },
      ]),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'SEX' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.dimension).toBe('SEX');
    expect(result.values).toHaveLength(3);
    expect(result.values[0]).toMatchObject({ code: 'SEX_BTSX', label: 'Both sexes' });
    expect(result.totalCount).toBe(3);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBeUndefined();
    expect(result.notice).toBeUndefined();
  });

  it('caps the bare URI at a default page rather than returning everything', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([{ code: 'ABW', label: 'Aruba' }], 234));
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'COUNTRY' });
    const result = await whoDimensionValuesResource.handler(params, ctx);

    expect(mockService.listDimensionValues).toHaveBeenCalledWith(
      { dimensionCode: 'COUNTRY', limit: 100, offset: 0 },
      expect.anything(),
    );
    expect(result.totalCount).toBe(234);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(1);
    expect(result.notice).toContain('offset 1');
  });

  it('throws not found for unknown dimension code', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([]));
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'NOTEXIST' });
    await expect(whoDimensionValuesResource.handler(params, ctx)).rejects.toThrow(
      /not exist|not found/i,
    );
  });

  it('returns sparse values without parent fields', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'AFR', label: 'African Region' }]),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesResource.params!.parse({ dimensionCode: 'REGION' });
    const result = await whoDimensionValuesResource.handler(params, ctx);
    expect(result.values[0]).toMatchObject({ code: 'AFR', label: 'African Region' });
    expect(result.values[0]?.parentCode).toBeUndefined();
  });
});

describe('whoDimensionValuesPageResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('coerces limit and offset out of the URI query string', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'AGO', label: 'Angola' }], 234),
    );
    const ctx = createMockContext();
    // URI template variables always arrive as strings.
    const params = whoDimensionValuesPageResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: '1',
      offset: '2',
    });
    const result = await whoDimensionValuesPageResource.handler(params, ctx);

    expect(mockService.listDimensionValues).toHaveBeenCalledWith(
      { dimensionCode: 'COUNTRY', limit: 1, offset: 2 },
      expect.anything(),
    );
    expect(result.offset).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(3);
  });

  it('returns an empty page when the offset lands exactly on the total', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([], 234));
    const ctx = createMockContext();
    const params = whoDimensionValuesPageResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: '100',
      offset: '234',
    });
    const result = await whoDimensionValuesPageResource.handler(params, ctx);

    // The bound is `offset >= total`, and a past-the-end page is not a not-found.
    expect(result.values).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextOffset).toBeUndefined();
    expect(result.notice).toContain('last reachable offset is 233');
  });

  it('returns an empty page when the offset runs past the total', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([], 234));
    const ctx = createMockContext();
    const params = whoDimensionValuesPageResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: '100',
      offset: '900',
    });
    const result = await whoDimensionValuesPageResource.handler(params, ctx);
    expect(result.values).toEqual([]);
    expect(result.notice).toContain('last reachable offset is 233');
  });

  it('still throws not found when an unfiltered first page is empty', async () => {
    mockService.listDimensionValues.mockResolvedValue(page([]));
    const ctx = createMockContext();
    const params = whoDimensionValuesPageResource.params!.parse({
      dimensionCode: 'NOTEXIST',
      limit: '100',
      offset: '0',
    });
    await expect(whoDimensionValuesPageResource.handler(params, ctx)).rejects.toThrow(
      /not exist|not found/i,
    );
  });
});

describe('whoDimensionValuesByParentResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards parentCode as a filter', async () => {
    mockService.listDimensionValues.mockResolvedValue(
      page([{ code: 'ALB', label: 'Albania', parentCode: 'EUR' }], 58),
    );
    const ctx = createMockContext();
    const params = whoDimensionValuesByParentResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: '100',
      offset: '0',
      parentCode: 'EUR',
    });
    const result = await whoDimensionValuesByParentResource.handler(params, ctx);

    expect(mockService.listDimensionValues).toHaveBeenCalledWith(
      { dimensionCode: 'COUNTRY', limit: 100, offset: 0, parentCode: 'EUR' },
      expect.anything(),
    );
    expect(result.totalCount).toBe(58);
    expect(result.values[0]?.parentCode).toBe('EUR');
  });

  it('returns an empty page when the parent filter matches nothing', async () => {
    // Upstream answers HTTP 200 with value: [] for both an unknown dimension and a
    // filter that matched nothing — only the unfiltered case may claim non-existence.
    mockService.listDimensionValues.mockResolvedValue(page([]));
    const ctx = createMockContext();
    const params = whoDimensionValuesByParentResource.params!.parse({
      dimensionCode: 'COUNTRY',
      limit: '100',
      offset: '0',
      parentCode: 'NOSUCHREGION',
    });
    const result = await whoDimensionValuesByParentResource.handler(params, ctx);

    expect(result.values).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.notice).toContain('NOSUCHREGION');
  });
});

describe('who dimension-values URI templates', () => {
  it('registers one template per URI shape, leaving the bare URI query-free', () => {
    // The SDK's RFC 6570 matcher compiles every query variable into a required,
    // order-sensitive capture group, so a single template with optional variables
    // would stop matching the bare URI. Each shape is registered on its own, and the
    // bare one must stay free of query expressions or existing readers break.
    expect(whoDimensionValuesResource.uriTemplate).toBe('who://dimension/{dimensionCode}/values');
    expect(whoDimensionValuesPageResource.uriTemplate).toBe(
      'who://dimension/{dimensionCode}/values{?limit,offset}',
    );
    expect(whoDimensionValuesByParentResource.uriTemplate).toBe(
      'who://dimension/{dimensionCode}/values{?limit,offset,parentCode}',
    );
  });

  it('gives each template a distinct registration name', () => {
    const names = [
      whoDimensionValuesResource.name,
      whoDimensionValuesPageResource.name,
      whoDimensionValuesByParentResource.name,
    ];
    expect(new Set(names).size).toBe(3);
  });
});

describe('who://dimension resources — malformed dimension code (#18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The URI template variable reaches the same URL path segment the tool's `dimension`
   * input does, so the resource shapes need the same fail-fast contract. They carry no
   * error contract of their own — the reason and hint the service attaches are what the
   * client reads, so this asserts they survive the resource handler untouched.
   */
  const malformed = () =>
    validationError('Dimension code is not encodable.', {
      reason: 'malformed_identifier',
      field: 'dimensionCode',
      recovery: { hint: 'Supply dimensionCode as text with no unpaired UTF-16 surrogate.' },
    });

  it.each([
    [
      'bare',
      () => whoDimensionValuesResource.handler({ dimensionCode: '\uD800' }, createMockContext()),
    ],
    [
      'paged',
      () =>
        whoDimensionValuesPageResource.handler(
          { dimensionCode: '\uD800', limit: 100, offset: 0 },
          createMockContext(),
        ),
    ],
    [
      'parent-filtered',
      () =>
        whoDimensionValuesByParentResource.handler(
          { dimensionCode: '\uD800', limit: 100, offset: 0, parentCode: 'EUR' },
          createMockContext(),
        ),
    ],
  ])('propagates the declared reason and hint from the %s URI shape', async (_shape, read) => {
    mockService.listDimensionValues.mockRejectedValue(malformed());

    await expect(read()).rejects.toMatchObject({
      data: {
        reason: 'malformed_identifier',
        field: 'dimensionCode',
        recovery: { hint: expect.stringContaining('dimensionCode') },
      },
    });
  });
});
