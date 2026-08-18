/**
 * @fileoverview Smoke coverage for every definition this server registers: the
 * definitions load, carry a well-formed MCP surface, and their schemas parse
 * representative payloads. Runs entirely offline — no handler is invoked, and a
 * strict fetch fake is installed so any accidental upstream call is loud.
 * @module tests/smoke/definitions.smoke.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { createFetchMock } from '@cyanheads/mcp-ts-core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  whoDimensionValuesByParentResource,
  whoDimensionValuesPageResource,
  whoDimensionValuesResource,
} from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import { whoIndicatorMetadataResource } from '@/mcp-server/resources/definitions/who-indicator-metadata.resource.js';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoListDimensions } from '@/mcp-server/tools/definitions/who-list-dimensions.tool.js';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';

const tools = [
  whoListDimensions,
  whoListDimensionValues,
  whoSearchIndicators,
  whoListIndicators,
  whoGetIndicatorMetadata,
  whoQueryIndicatorData,
];

const resources = [
  whoIndicatorMetadataResource,
  whoDimensionValuesResource,
  whoDimensionValuesPageResource,
  whoDimensionValuesByParentResource,
];

/** Unrouted fake — any request throws, so a smoke test can never touch the network. */
const upstream = createFetchMock();

beforeAll(() => {
  upstream.install();
});

afterAll(() => {
  upstream.restore();
});

describe('tool definitions', () => {
  it('registers six uniquely named snake_case tools', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'who_list_dimensions',
      'who_list_dimension_values',
      'who_search_indicators',
      'who_list_indicators',
      'who_get_indicator_metadata',
      'who_query_indicator_data',
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it.each(tools.map((t) => [t.name, t] as const))(
    '%s carries a described, JSON-Schema-serializable surface',
    (_name, definition) => {
      expect(definition.description).toBeTruthy();
      expect(definition.title).toBeTruthy();
      expect(definition.annotations?.readOnlyHint).toBe(true);
      expect(() => z.toJSONSchema(definition.input)).not.toThrow();
      expect(() => z.toJSONSchema(definition.output)).not.toThrow();
    },
  );

  it('parses representative inputs and applies the declared defaults', () => {
    expect(whoListDimensions.input.parse({})).toEqual({});

    expect(whoSearchIndicators.input.parse({ query: 'life expectancy' })).toEqual({
      query: 'life expectancy',
      limit: 20,
      offset: 0,
    });

    expect(whoListIndicators.input.parse({})).toEqual({ limit: 50, offset: 0 });

    expect(whoListDimensionValues.input.parse({ dimension: 'COUNTRY' })).toEqual({
      dimension: 'COUNTRY',
      limit: 100,
      offset: 0,
    });

    expect(whoGetIndicatorMetadata.input.parse({ indicator_codes: ['WHOSIS_000001'] })).toEqual({
      indicator_codes: ['WHOSIS_000001'],
    });

    expect(
      whoQueryIndicatorData.input.parse({
        indicator_code: 'WHOSIS_000001',
        country_codes: ['JPN'],
      }),
    ).toEqual({
      indicator_code: 'WHOSIS_000001',
      country_codes: ['JPN'],
      include_uncertainty: true,
      limit: 200,
      offset: 0,
      sort: 'year_desc',
    });
  });

  it('rejects inputs that violate the declared constraints', () => {
    expect(whoSearchIndicators.input.safeParse({ query: '' }).success).toBe(false);
    expect(whoSearchIndicators.input.safeParse({ query: 'x', limit: 101 }).success).toBe(false);
    expect(whoListDimensionValues.input.safeParse({ dimension: 'SEX', limit: 501 }).success).toBe(
      false,
    );
    expect(whoQueryIndicatorData.input.safeParse({ indicator_code: '' }).success).toBe(false);
    expect(
      whoQueryIndicatorData.input.safeParse({ indicator_code: 'X', limit: 1001 }).success,
    ).toBe(false);
    expect(whoQueryIndicatorData.input.safeParse({ indicator_code: 'X', sex: 'F' }).success).toBe(
      false,
    );
    expect(whoGetIndicatorMetadata.input.safeParse({ indicator_codes: [] }).success).toBe(false);
    expect(
      whoGetIndicatorMetadata.input.safeParse({
        indicator_codes: Array.from({ length: 11 }, (_, i) => `C${i}`),
      }).success,
    ).toBe(false);
  });

  it('declares an error contract with a recovery hint on every entry', () => {
    for (const definition of tools) {
      for (const entry of definition.errors ?? []) {
        expect(entry.reason).toBeTruthy();
        expect(entry.when).toBeTruthy();
        expect(entry.recovery.split(/\s+/).length).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe('resource definitions', () => {
  it('registers four uniquely templated resources', () => {
    expect(resources.map((r) => r.uriTemplate)).toEqual([
      'who://indicator/{indicatorCode}/metadata',
      'who://dimension/{dimensionCode}/values',
      'who://dimension/{dimensionCode}/values{?limit,offset}',
      'who://dimension/{dimensionCode}/values{?limit,offset,parentCode}',
    ]);
    expect(new Set(resources.map((r) => r.name)).size).toBe(resources.length);
  });

  it.each(resources.map((r) => [r.uriTemplate, r] as const))(
    '%s carries a described, JSON-Schema-serializable surface',
    (_template, definition) => {
      expect(definition.description).toBeTruthy();
      expect(definition.mimeType).toBe('application/json');
      expect(() => z.toJSONSchema(definition.params!)).not.toThrow();
    },
  );

  it('parses URI template variables, coercing the numeric ones from strings', () => {
    expect(whoIndicatorMetadataResource.params!.parse({ indicatorCode: 'WHOSIS_000001' })).toEqual({
      indicatorCode: 'WHOSIS_000001',
    });

    expect(whoDimensionValuesResource.params!.parse({ dimensionCode: 'COUNTRY' })).toEqual({
      dimensionCode: 'COUNTRY',
    });

    expect(
      whoDimensionValuesPageResource.params!.parse({
        dimensionCode: 'COUNTRY',
        limit: '50',
        offset: '100',
      }),
    ).toEqual({ dimensionCode: 'COUNTRY', limit: 50, offset: 100 });

    expect(
      whoDimensionValuesByParentResource.params!.parse({
        dimensionCode: 'COUNTRY',
        parentCode: 'EUR',
        limit: '25',
        offset: '0',
      }),
    ).toEqual({ dimensionCode: 'COUNTRY', parentCode: 'EUR', limit: 25, offset: 0 });
  });

  it('rejects out-of-range page variables', () => {
    expect(
      whoDimensionValuesPageResource.params!.safeParse({
        dimensionCode: 'COUNTRY',
        limit: '501',
        offset: '0',
      }).success,
    ).toBe(false);
    expect(
      whoDimensionValuesPageResource.params!.safeParse({
        dimensionCode: 'COUNTRY',
        limit: '10',
        offset: '-1',
      }).success,
    ).toBe(false);
  });
});

describe('offline guarantee', () => {
  it('made no upstream request while loading and parsing definitions', () => {
    expect(upstream.calls).toHaveLength(0);
  });
});
