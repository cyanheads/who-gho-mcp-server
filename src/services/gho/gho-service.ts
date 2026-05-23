/**
 * @fileoverview GHO OData API client for the WHO Global Health Observatory.
 * @module services/gho/gho-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { notFound, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import type {
  DataQueryParams,
  DataRow,
  Dimension,
  DimensionValue,
  Indicator,
  IndicatorDimensionEntry,
  ODataEnvelope,
  RawDataRow,
  RawDimension,
  RawDimensionValue,
  RawIndicator,
  RawIndicatorDimension,
} from './types.js';

/** Dimensions that are internal publishing workflow states, not user-filterable data dimensions. */
const INTERNAL_DIMENSIONS = new Set(['PUBLISHSTATE']);

export class GhoService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(_config: AppConfig, _storage: StorageService) {
    const serverCfg = getServerConfig();
    // Ensure base URL has no trailing slash for consistent concatenation
    this.baseUrl = serverCfg.baseUrl.replace(/\/$/, '');
    this.timeoutMs = serverCfg.requestTimeoutMs;
  }

  /** Fetch the indicator catalog with optional keyword search. */
  listIndicators(
    params: { query?: string; limit: number; offset: number },
    ctx: Context,
  ): Promise<{ indicators: Indicator[]; total: number }> {
    return withRetry(
      async () => {
        const qs = new URLSearchParams({
          $top: String(params.limit),
          $skip: String(params.offset),
          $count: 'true',
        });
        if (params.query) {
          qs.set('$filter', `contains(IndicatorName,'${this.escapeODataString(params.query)}')`);
        }
        const url = `${this.baseUrl}/Indicator?${qs}`;
        const data = await this.getJson<ODataEnvelope<RawIndicator>>(url, ctx);
        return {
          indicators: data.value.map((r) => ({
            indicatorCode: r.IndicatorCode,
            indicatorName: r.IndicatorName,
          })),
          total: data['@odata.count'] ?? data.value.length,
        };
      },
      { operation: 'GhoService.listIndicators', signal: ctx.signal },
    );
  }

  /** Fetch all dimension type codes and titles. */
  listDimensions(ctx: Context): Promise<Dimension[]> {
    return withRetry(
      async () => {
        const url = `${this.baseUrl}/DIMENSION`;
        const data = await this.getJson<ODataEnvelope<RawDimension>>(url, ctx);
        return data.value.map((d) => ({ code: d.Code, title: d.Title }));
      },
      { operation: 'GhoService.listDimensions', signal: ctx.signal },
    );
  }

  /** Fetch valid values for a dimension type. Returns empty array if unknown code. */
  listDimensionValues(dimensionCode: string, ctx: Context): Promise<DimensionValue[]> {
    return withRetry(
      async () => {
        const url = `${this.baseUrl}/DIMENSION/${encodeURIComponent(dimensionCode)}/DimensionValues`;
        const data = await this.getJson<ODataEnvelope<RawDimensionValue>>(url, ctx);
        return data.value.map((v) => {
          const entry: DimensionValue = { code: v.Code, label: v.Title };
          if (v.ParentCode) entry.parentCode = v.ParentCode;
          if (v.ParentTitle) entry.parentLabel = v.ParentTitle;
          if (v.ParentDimension) entry.parentDimension = v.ParentDimension;
          return entry;
        });
      },
      { operation: 'GhoService.listDimensionValues', signal: ctx.signal },
    );
  }

  /**
   * Fetch dimension metadata for multiple indicator codes in parallel.
   * Returns a map of code → dimensions. Codes with empty metadata are absent from the map.
   */
  async getIndicatorDimensions(
    indicatorCodes: string[],
    ctx: Context,
  ): Promise<Map<string, IndicatorDimensionEntry[]>> {
    const results = await Promise.all(
      indicatorCodes.map(async (code) => {
        const dims = await withRetry(
          async () => {
            const qs = new URLSearchParams({
              $filter: `IndicatorCode eq '${this.escapeODataString(code)}'`,
            });
            const url = `${this.baseUrl}/IndicatorDimension?${qs}`;
            const data = await this.getJson<ODataEnvelope<RawIndicatorDimension>>(url, ctx);
            return data.value
              .filter((d) => !INTERNAL_DIMENSIONS.has(d.Dimension))
              .map((d) => ({ dimension: d.Dimension, dimensionName: d.DimensionName }));
          },
          {
            operation: `GhoService.getIndicatorDimensions(${code})`,
            signal: ctx.signal,
          },
        );
        return [code, dims] as const;
      }),
    );
    const map = new Map<string, IndicatorDimensionEntry[]>();
    for (const [code, dims] of results) {
      if (dims.length > 0) map.set(code, dims);
    }
    return map;
  }

  /** Query data rows for an indicator with optional OData filters. */
  queryData(
    params: DataQueryParams,
    ctx: Context,
  ): Promise<{ rows: DataRow[]; totalRows: number; truncated: boolean }> {
    return withRetry(
      async () => {
        const filterParts: string[] = [];

        // Spatial filter: at most one of country/region/income group
        if (params.countryCodes?.length) {
          const codes = params.countryCodes.map((c) => `'${this.escapeODataString(c)}'`).join(',');
          filterParts.push(`SpatialDimType eq 'COUNTRY' and SpatialDim in (${codes})`);
        } else if (params.regionCodes?.length) {
          const codes = params.regionCodes.map((c) => `'${this.escapeODataString(c)}'`).join(',');
          filterParts.push(`SpatialDimType eq 'REGION' and SpatialDim in (${codes})`);
        } else if (params.incomeGroupCodes?.length) {
          const codes = params.incomeGroupCodes
            .map((c) => `'${this.escapeODataString(c)}'`)
            .join(',');
          filterParts.push(`SpatialDimType eq 'WORLDBANKINCOMEGROUP' and SpatialDim in (${codes})`);
        }

        // Year range
        if (params.yearFrom != null) filterParts.push(`TimeDim ge ${params.yearFrom}`);
        if (params.yearTo != null) filterParts.push(`TimeDim le ${params.yearTo}`);

        // Dim1 filter: sex takes precedence, then arbitrary dim1_value
        if (params.sex) {
          filterParts.push(`Dim1Type eq 'SEX' and Dim1 eq '${this.escapeODataString(params.sex)}'`);
        } else if (params.dim1Value) {
          filterParts.push(`Dim1 eq '${this.escapeODataString(params.dim1Value)}'`);
        }

        // Field selection
        const selectFields = [
          'IndicatorCode',
          'SpatialDimType',
          'SpatialDim',
          'TimeDim',
          'ParentLocation',
          'Dim1Type',
          'Dim1',
          'Dim2Type',
          'Dim2',
          'NumericValue',
          'Value',
          'Comments',
          ...(params.includeUncertainty ? ['Low', 'High'] : []),
        ];

        const qs = new URLSearchParams({
          $top: String(params.limit),
          $count: 'true',
          $select: selectFields.join(','),
        });
        if (filterParts.length > 0) {
          qs.set('$filter', filterParts.join(' and '));
        }

        const url = `${this.baseUrl}/${encodeURIComponent(params.indicatorCode)}?${qs}`;
        const response = await this.fetchRaw(url, ctx);

        // 404 means unknown indicator code
        if (response.status === 404) {
          throw notFound(`Indicator code "${params.indicatorCode}" not found in the GHO catalog.`, {
            reason: 'indicator_not_found',
            indicatorCode: params.indicatorCode,
          });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'GHO API returned HTML instead of JSON — possibly rate-limited or temporarily unavailable.',
          );
        }

        let data: ODataEnvelope<RawDataRow>;
        try {
          data = JSON.parse(text) as ODataEnvelope<RawDataRow>;
        } catch {
          throw serviceUnavailable('GHO API returned unparseable response.');
        }

        const totalRows = data['@odata.count'] ?? data.value.length;
        const rows = data.value.map((r) => this.normalizeRow(r, params.includeUncertainty));

        return { rows, totalRows, truncated: totalRows > params.limit };
      },
      { operation: 'GhoService.queryData', signal: ctx.signal },
    );
  }

  private normalizeRow(r: RawDataRow, includeUncertainty: boolean): DataRow {
    const row: DataRow = {
      indicatorCode: r.IndicatorCode,
      year: r.TimeDim ?? 0,
    };
    if (r.SpatialDimType) row.spatialDimType = r.SpatialDimType;
    if (r.SpatialDim) row.spatialDim = r.SpatialDim;
    if (r.ParentLocation) row.spatialLabel = r.ParentLocation;
    if (r.Dim1Type) row.dim1Type = r.Dim1Type;
    if (r.Dim1) row.dim1 = r.Dim1;
    if (r.Dim2Type) row.dim2Type = r.Dim2Type;
    if (r.Dim2) row.dim2 = r.Dim2;
    if (r.NumericValue != null) row.numericValue = r.NumericValue;
    if (includeUncertainty) {
      if (r.Low != null) row.low = r.Low;
      if (r.High != null) row.high = r.High;
    }
    if (r.Value) row.displayValue = r.Value;
    if (r.Comments) row.comments = r.Comments;
    return row;
  }

  /**
   * Raw fetch with composed timeout + cancellation signal.
   * Does not throw on non-2xx — callers inspect `response.status` as needed.
   */
  private async fetchRaw(url: string, ctx: Context): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (ctx.signal.aborted) {
        throw serviceUnavailable('Request cancelled.', { url });
      }
      throw serviceUnavailable(`Network error fetching ${url}`, { url }, { cause: err });
    } finally {
      clearTimeout(timeoutId);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }

  /** Internal: fetch JSON from a URL and parse the OData envelope. Throws ServiceUnavailable on non-2xx. */
  private async getJson<T>(url: string, ctx: Context): Promise<T> {
    const response = await this.fetchRaw(url, ctx);
    if (!response.ok) {
      throw serviceUnavailable(`GHO API returned HTTP ${response.status} for ${url}.`);
    }
    const text = await response.text();
    if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
      throw serviceUnavailable(
        'GHO API returned HTML instead of JSON — possibly rate-limited or temporarily unavailable.',
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw serviceUnavailable('GHO API returned unparseable response.');
    }
  }

  /** Escape single quotes in OData string values. */
  private escapeODataString(value: string): string {
    return value.replace(/'/g, "''");
  }
}

// --- Init/accessor pattern ---

let _service: GhoService | undefined;

export function initGhoService(config: AppConfig, storage: StorageService): void {
  _service = new GhoService(config, storage);
}

export function getGhoService(): GhoService {
  if (!_service) {
    throw new Error('GhoService not initialized — call initGhoService() in setup()');
  }
  return _service;
}
