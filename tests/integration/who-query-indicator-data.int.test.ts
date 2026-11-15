/**
 * @fileoverview Tool-contract coverage for who_query_indicator_data — the full
 * definition → handler → service → OData query-string path against a stubbed upstream.
 * @module tests/integration/who-query-indicator-data.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';
import { expect } from 'vitest';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { BASE, odata, useGhoUpstream } from './gho-upstream.js';

/** Upstream corpus for the one code that resolves; paged by the request's $top/$skip. */
const ROWS = [
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
    Value: '84.5 [84.5-84.5]',
    Low: 84.1,
    High: 84.9,
  },
  {
    IndicatorCode: 'WHOSIS_000001',
    SpatialDimType: 'COUNTRY',
    SpatialDim: 'JPN',
    TimeDim: 2020,
    ParentLocation: 'Western Pacific',
    ParentLocationCode: 'WPR',
    Dim1Type: 'SEX',
    Dim1: 'SEX_BTSX',
    NumericValue: 84.3,
    Value: '84.3',
  },
  {
    IndicatorCode: 'WHOSIS_000001',
    SpatialDimType: 'REGION',
    SpatialDim: 'EUR',
    TimeDim: 2021,
    NumericValue: 79.3,
    Value: '79.3',
  },
];

/** Two estimates for one country, year and sex that differ only in their source survey. */
const SOURCED_ROWS = [
  ['DATASOURCE_NLIS_312831', 16.7],
  ['DATASOURCE_NLIS_311568', 18.8],
].map(([dataSource, value]) => ({
  IndicatorCode: 'NUTRITION_564',
  SpatialDimType: 'COUNTRY',
  SpatialDim: 'BGD',
  TimeDim: 1992,
  ParentLocation: 'South-East Asia',
  ParentLocationCode: 'SEAR',
  Dim1Type: 'SEX',
  Dim1: 'SEX_BTSX',
  DataSourceDimType: 'DATASOURCE',
  DataSourceDim: dataSource,
  NumericValue: value,
  Value: String(value),
}));

/** Aggregate rows of a non-WHO geography type, with the upstream's null parent fields. */
const WB_REGION_ROWS = [2021, 2019].map((year) => ({
  IndicatorCode: 'UHC_INDEX_REPORTED',
  SpatialDimType: 'WORLDBANKREGION',
  SpatialDim: 'WB_SSA',
  TimeDim: year,
  ParentLocation: null,
  ParentLocationCode: null,
  DataSourceDimType: null,
  DataSourceDim: null,
  NumericValue: 44,
  Value: '44',
}));

const textOf = (result: { content: { type: string; text?: string }[] }): string =>
  result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

const upstream = useGhoUpstream({
  match: (request) => request.url.startsWith(`${BASE}/`),
  respond: (request) => {
    const url = new URL(request.url);
    const code = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (code === 'GHO_MISSING') return new Response('Not Found', { status: 404 });
    if (code === 'GHO_EMPTY') return odata([], 0);
    if (code === 'SPARSE')
      return odata(
        [
          {
            IndicatorCode: 'SPARSE',
            Dim1: 'VALUE1',
            Dim2Type: 'AGEGROUP',
            Dim3: 'CAUSE3',
            Low: 0,
            High: null,
          },
          {
            IndicatorCode: 'SPARSE',
            Dim1Type: 'SEX',
            Dim2: 'VALUE2',
            Dim3Type: 'CHILDCAUSE',
            High: 12,
          },
        ],
        2,
      );
    if (code === 'GHO_BADQUERY') {
      return Response.json({ error: { message: 'Invalid OData literal in $filter.' } });
    }
    if (code === 'NUTRITION_564') return odata(SOURCED_ROWS);
    if (code === 'UHC_INDEX_REPORTED') return odata(WB_REGION_ROWS);
    const top = Number(url.searchParams.get('$top'));
    const skip = Number(url.searchParams.get('$skip'));
    return odata(ROWS.slice(skip, skip + top), ROWS.length);
  },
});

/** Query params of the request the service just emitted. */
const lastQuery = (): URLSearchParams =>
  new URL(upstream.calls[upstream.calls.length - 1]!.request.url).searchParams;

toolContractSuite(whoQueryIndicatorData, {
  success: [
    ...(['dim2_value', 'dim3_value'] as const).map((field, index) => ({
      name: `wires independent ${field}`,
      input: { indicator_code: 'WHOSIS_000001', [field]: 'VALUE' },
      assert: () => {
        expect(lastQuery().get('$filter')).toBe(`Dim${index + 2} eq 'VALUE'`);
      },
    })),
    {
      name: 'omits both sparse uncertainty bounds when disabled',
      input: { indicator_code: 'SPARSE', include_uncertainty: false },
      assert: (result) => {
        const rows = (result.structuredContent as { rows: object[] }).rows;
        for (const row of rows) {
          expect(row).not.toHaveProperty('low');
          expect(row).not.toHaveProperty('high');
        }
        const text = JSON.stringify(result.content);
        expect(text).not.toContain('low:');
        expect(text).not.toContain('high:');
        expect(lastQuery().get('$select')).not.toContain('Low');
      },
    },
    {
      name: 'preserves sparse dimensions and one-sided uncertainty on both surfaces',
      input: { indicator_code: 'SPARSE' },
      assert: (result) => {
        expect(result.structuredContent).toMatchObject({
          rows: [
            {
              indicatorCode: 'SPARSE',
              dim1: 'VALUE1',
              dim2Type: 'AGEGROUP',
              dim3: 'CAUSE3',
              low: 0,
            },
            {
              indicatorCode: 'SPARSE',
              dim1Type: 'SEX',
              dim2: 'VALUE2',
              dim3Type: 'CHILDCAUSE',
              high: 12,
            },
          ],
        });
        const text = result.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n');
        for (const value of [
          'VALUE1',
          'VALUE2',
          'CAUSE3',
          'AGEGROUP',
          'SEX',
          'CHILDCAUSE',
          '[low: 0]',
          '[high: 12]',
        ])
          expect(text).toContain(value);
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('numeric=');
      },
    },
    {
      name: 'wires independently escaped Dim2 and Dim3 predicates and effective echoes',
      input: {
        indicator_code: 'WHOSIS_000001',
        dim2_value: "AGE'GROUP",
        dim3_value: 'CHILDCAUSE_CH9',
        sex: 'SEX_FMLE',
        dim1_value: 'IGNORED',
        limit: 1,
      },
      assert: (result) => {
        expect(lastQuery().get('$filter')).toBe(
          "Dim1Type eq 'SEX' and Dim1 eq 'SEX_FMLE' and Dim2 eq 'AGE''GROUP' and Dim3 eq 'CHILDCAUSE_CH9'",
        );
        expect(lastQuery().get('$select')).toContain('Dim3Type,Dim3');
        expect(result.structuredContent).toMatchObject({
          appliedFilters: { sex: 'SEX_FMLE', dim2Value: "AGE'GROUP", dim3Value: 'CHILDCAUSE_CH9' },
          truncated: true,
        });
        expect(
          (result.structuredContent as { appliedFilters: object }).appliedFilters,
        ).not.toHaveProperty('dim1Value');
        const text = result.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n');
        for (const value of ["AGE'GROUP", 'CHILDCAUSE_CH9', 'dim1_value', 'Request offset 1'])
          expect(text).toContain(value);
      },
    },
    {
      name: 'returns rows and emits a country spatial filter ordered most-recent-first',
      input: { indicator_code: 'WHOSIS_000001', country_codes: ['JPN', 'USA'] },
      assert: () => {
        const query = lastQuery();
        expect(query.get('$filter')).toBe(
          "SpatialDimType eq 'COUNTRY' and SpatialDim in ('JPN','USA')",
        );
        expect(query.get('$orderby')).toBe('TimeDim desc,SpatialDim,Dim1,Id');
        expect(query.get('$select')).toContain('Low,High');
        expect(query.get('$count')).toBe('true');
      },
    },
    {
      name: 'emits a region filter, a bounded year range, and the ascending order',
      input: {
        indicator_code: 'WHOSIS_000001',
        region_codes: ['EUR'],
        year_from: 2015,
        year_to: 2021,
        sort: 'year_asc',
        include_uncertainty: false,
      },
      assert: () => {
        const query = lastQuery();
        expect(query.get('$filter')).toBe(
          "SpatialDimType eq 'REGION' and SpatialDim in ('EUR') and TimeDim ge 2015 and TimeDim le 2021",
        );
        expect(query.get('$orderby')).toBe('TimeDim asc,SpatialDim,Dim1,Id');
        expect(query.get('$select')).not.toContain('Low');
      },
    },
    {
      name: 'doubles apostrophes in dimension filter literals',
      input: { indicator_code: 'WHOSIS_000001', dim1_value: "O'Brien" },
      assert: () => {
        expect(lastQuery().get('$filter')).toBe("Dim1 eq 'O''Brien'");
      },
    },
    {
      name: 'emits a sex filter ahead of dim1_value when both are supplied',
      input: {
        indicator_code: 'WHOSIS_000001',
        sex: 'SEX_FMLE',
        dim1_value: 'AGEGROUP_YEARS05-14',
      },
      assert: () => {
        expect(lastQuery().get('$filter')).toBe("Dim1Type eq 'SEX' and Dim1 eq 'SEX_FMLE'");
      },
    },
    {
      name: 'pages the result set and reports the next offset',
      input: { indicator_code: 'WHOSIS_000001', limit: 1, offset: 1 },
      expected: { rows: [{ indicatorCode: 'WHOSIS_000001', year: 2020, numericValue: 84.3 }] },
      assert: (result) => {
        const query = lastQuery();
        expect(query.get('$top')).toBe('1');
        expect(query.get('$skip')).toBe('1');
        expect(result.structuredContent).toMatchObject({
          totalRows: 3,
          offset: 1,
          hasMore: true,
          nextOffset: 2,
        });
      },
    },
    {
      name: 'returns an empty page rather than an error when the offset runs past the end',
      input: { indicator_code: 'WHOSIS_000001', offset: 99 },
      expected: { rows: [] },
      assert: (result) => {
        expect(result.structuredContent).toMatchObject({ totalRows: 3, hasMore: false });
        expect((result.structuredContent as { notice?: string }).notice).toContain('99');
      },
    },
    {
      name: 'selects the data-source fields and keeps two sources for one country-year-sex apart (#39)',
      input: {
        indicator_code: 'NUTRITION_564',
        country_codes: ['BGD'],
        year_from: 1992,
        year_to: 1992,
        sex: 'SEX_BTSX',
      },
      expected: {
        rows: [
          {
            indicatorCode: 'NUTRITION_564',
            dataSourceDimType: 'DATASOURCE',
            dataSourceDim: 'DATASOURCE_NLIS_312831',
          },
          {
            indicatorCode: 'NUTRITION_564',
            dataSourceDimType: 'DATASOURCE',
            dataSourceDim: 'DATASOURCE_NLIS_311568',
          },
        ],
      },
      assert: (result) => {
        expect(lastQuery().get('$select')).toContain('Dim3,DataSourceDimType,DataSourceDim');
        const text = textOf(result);
        expect(text).toContain('| SEX: SEX_BTSX | DATASOURCE: DATASOURCE_NLIS_312831 display=16.7');
        expect(text).toContain('| SEX: SEX_BTSX | DATASOURCE: DATASOURCE_NLIS_311568 display=18.8');
      },
    },
    {
      name: 'appends the data_source predicate after the existing clauses and echoes it (#39)',
      input: {
        indicator_code: 'NUTRITION_564',
        country_codes: ['BGD'],
        year_from: 1992,
        sex: 'SEX_BTSX',
        data_source: 'DATASOURCE_NLIS_312831',
      },
      assert: (result) => {
        expect(lastQuery().get('$filter')).toBe(
          "SpatialDimType eq 'COUNTRY' and SpatialDim in ('BGD') and TimeDim ge 1992 and Dim1Type eq 'SEX' and Dim1 eq 'SEX_BTSX' and DataSourceDim eq 'DATASOURCE_NLIS_312831'",
        );
        expect(result.structuredContent).toMatchObject({
          appliedFilters: { dataSource: 'DATASOURCE_NLIS_312831' },
        });
        expect(textOf(result)).toContain('- **Data source:** DATASOURCE_NLIS_312831');
      },
    },
    {
      name: 'leaves rows without a data-source coordinate unchanged on both surfaces (#39)',
      input: { indicator_code: 'UHC_INDEX_REPORTED', spatial_type: 'WORLDBANKREGION' },
      assert: (result) => {
        for (const row of (result.structuredContent as { rows: object[] }).rows) {
          expect(row).not.toHaveProperty('dataSourceDim');
          expect(row).not.toHaveProperty('dataSourceDimType');
        }
        expect(textOf(result)).not.toMatch(/DATASOURCE|DataSource/);
      },
    },
    {
      name: 'emits a spatial-type predicate for an aggregate geography (#40)',
      input: {
        indicator_code: 'WHOSIS_000001',
        spatial_type: 'GLOBAL',
        sex: 'SEX_BTSX',
        year_from: 2021,
      },
      assert: (result) => {
        expect(lastQuery().get('$filter')).toBe(
          "SpatialDimType eq 'GLOBAL' and TimeDim ge 2021 and Dim1Type eq 'SEX' and Dim1 eq 'SEX_BTSX'",
        );
        expect(result.structuredContent).toMatchObject({
          appliedFilters: { spatialFilter: 'spatial_type: GLOBAL' },
        });
      },
    },
    {
      name: 'narrows a spatial type to its codes and names the code that matched nothing (#40)',
      input: {
        indicator_code: 'UHC_INDEX_REPORTED',
        spatial_type: 'WORLDBANKREGION',
        spatial_codes: ['WB_SSA', 'NOPE'],
      },
      assert: (result) => {
        expect(lastQuery().get('$filter')).toBe(
          "SpatialDimType eq 'WORLDBANKREGION' and SpatialDim in ('WB_SSA','NOPE')",
        );
        expect(result.structuredContent).toMatchObject({
          rows: [{ spatialDim: 'WB_SSA' }, { spatialDim: 'WB_SSA' }],
          appliedFilters: {
            spatialFilter: 'spatial_type: WORLDBANKREGION; spatial_codes: WB_SSA,NOPE',
          },
          notice: 'Spatial codes with unknown code or no data for these filters: NOPE.',
        });
        const text = textOf(result);
        expect(text).toContain('spatial_type: WORLDBANKREGION; spatial_codes: WB_SSA,NOPE');
        expect(text).toContain('no data for these filters: NOPE.');
      },
    },
  ],
  errors: [
    {
      name: 'rejects two spatial filter shapes in one call',
      input: { indicator_code: 'WHOSIS_000001', country_codes: ['JPN'], region_codes: ['EUR'] },
      code: JsonRpcErrorCode.ValidationError,
      reason: 'ambiguous_spatial_filter',
    },
    {
      name: 'rejects spatial_type beside another spatial filter (#40)',
      input: { indicator_code: 'WHOSIS_000001', spatial_type: 'GLOBAL', region_codes: ['EUR'] },
      code: JsonRpcErrorCode.ValidationError,
      reason: 'ambiguous_spatial_filter',
    },
    {
      name: 'rejects spatial_codes without spatial_type (#40)',
      input: { indicator_code: 'WHOSIS_000001', spatial_codes: ['WB_SSA'] },
      code: JsonRpcErrorCode.ValidationError,
      reason: 'spatial_codes_without_type',
    },
    {
      name: 'reports a spatial type that matched no rows (#40)',
      input: { indicator_code: 'GHO_EMPTY', spatial_type: 'NOPE' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'no_data',
    },
    {
      name: 'reports a data source that matched no rows (#39)',
      input: { indicator_code: 'GHO_EMPTY', data_source: 'NLIS_312831' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'no_data',
    },
    {
      name: 'rejects an inverted year range',
      input: { indicator_code: 'WHOSIS_000001', year_from: 2020, year_to: 2010 },
      code: JsonRpcErrorCode.ValidationError,
      reason: 'invalid_year_range',
    },
    {
      name: 'reports an indicator code the upstream answers with 404',
      input: { indicator_code: 'GHO_MISSING' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'indicator_not_found',
    },
    {
      name: 'reports filters that matched no rows',
      input: { indicator_code: 'GHO_EMPTY' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'no_data',
    },
    {
      name: 'reports an OData error envelope served under HTTP 200',
      input: { indicator_code: 'GHO_BADQUERY' },
      code: JsonRpcErrorCode.ValidationError,
      reason: 'invalid_query',
    },
  ],
});
