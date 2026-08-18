/**
 * @fileoverview GHO OData API client for the WHO Global Health Observatory.
 * @module services/gho/gho-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, notFound, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
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

  /** Fetch the indicator catalog with optional keyword search or exact-code lookup. */
  listIndicators(
    params: { query?: string; indicatorCode?: string; limit: number; offset: number },
    ctx: Context,
  ): Promise<{ indicators: Indicator[]; total: number }> {
    return withRetry(
      async () => {
        const qs = new URLSearchParams({
          $top: String(params.limit),
          $skip: String(params.offset),
          $count: 'true',
          // Offset paging is only sound over a guaranteed order; the catalog's
          // unique key pins it by contract rather than by observed upstream behavior.
          $orderby: 'IndicatorCode',
        });
        if (params.indicatorCode) {
          // Exact match by code — codes are not substrings of names, so contains() fails here.
          qs.set('$filter', `IndicatorCode eq '${this.escapeODataString(params.indicatorCode)}'`);
        } else if (params.query) {
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
      { context: ctx, operation: 'GhoService.listIndicators', signal: ctx.signal },
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
      { context: ctx, operation: 'GhoService.listDimensions', signal: ctx.signal },
    );
  }

  /** Fetch valid values for a dimension type. Returns empty array if unknown code. */
  listDimensionValues(dimensionCode: string, ctx: Context): Promise<DimensionValue[]> {
    return withRetry(
      async () => {
        const url = `${this.baseUrl}/DIMENSION/${encodeURIComponent(dimensionCode)}/DimensionValues`;
        const data = await this.getJson<ODataEnvelope<RawDimensionValue>>(url, ctx);
        return data.value.map((v) => ({
          code: v.Code,
          label: v.Title,
          ...(v.ParentCode && { parentCode: v.ParentCode }),
          ...(v.ParentTitle && { parentLabel: v.ParentTitle }),
          ...(v.ParentDimension && { parentDimension: v.ParentDimension }),
        }));
      },
      { context: ctx, operation: 'GhoService.listDimensionValues', signal: ctx.signal },
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
            context: ctx,
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
          $skip: String(params.offset),
          $count: 'true',
          $select: selectFields.join(','),
          $orderby: params.orderBy,
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

        const data = await this.parseJsonBody<ODataEnvelope<RawDataRow>>(response);

        // GHO API returns {"error": {...}} when the OData query is rejected (e.g. malformed filter).
        if ('error' in data) {
          const oErr = (data as { error: { message?: string } }).error;
          ctx.log.warning('GHO API rejected the OData query', { url });
          throw serviceUnavailable(oErr.message ?? 'GHO API returned an OData error response.', {
            reason: 'invalid_query',
            // A rejected query is deterministic — withRetry's defaultIsTransient honors
            // this flag ahead of the code lookup, so it fails on the first attempt
            // instead of burning the full ServiceUnavailable retry budget.
            retryable: false,
          });
        }

        const totalRows = data['@odata.count'] ?? data.value.length;
        const rows = data.value.map((r) => this.normalizeRow(r, params.includeUncertainty));

        return { rows, totalRows, truncated: params.offset + rows.length < totalRows };
      },
      { context: ctx, operation: 'GhoService.queryData', signal: ctx.signal },
    );
  }

  private normalizeRow(r: RawDataRow, includeUncertainty: boolean): DataRow {
    return {
      indicatorCode: r.IndicatorCode,
      ...(r.TimeDim != null && { year: r.TimeDim }),
      ...(r.SpatialDimType && { spatialDimType: r.SpatialDimType }),
      ...(r.SpatialDim && { spatialDim: r.SpatialDim }),
      ...(r.ParentLocation && { spatialLabel: r.ParentLocation }),
      ...(r.Dim1Type && { dim1Type: r.Dim1Type }),
      ...(r.Dim1 && { dim1: r.Dim1 }),
      ...(r.Dim2Type && { dim2Type: r.Dim2Type }),
      ...(r.Dim2 && { dim2: r.Dim2 }),
      ...(r.NumericValue != null && { numericValue: r.NumericValue }),
      ...(includeUncertainty && r.Low != null && { low: r.Low }),
      ...(includeUncertainty && r.High != null && { high: r.High }),
      ...(r.Value && { displayValue: r.Value }),
      ...(r.Comments && { comments: r.Comments }),
    };
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
    } catch (err: unknown) {
      if (ctx.signal.aborted) {
        ctx.log.debug('GHO API request cancelled', { url });
        throw serviceUnavailable('Request cancelled.');
      }
      ctx.log.warning('Network error contacting the GHO API', { url });
      throw serviceUnavailable('Network error contacting the GHO API.', undefined, {
        cause: err,
      });
    } finally {
      clearTimeout(timeoutId);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }

  /** Internal: fetch JSON from a URL and parse the OData envelope. Throws ServiceUnavailable on non-2xx. */
  private async getJson<T>(url: string, ctx: Context): Promise<T> {
    const response = await this.fetchRaw(url, ctx);
    if (!response.ok) {
      ctx.log.warning('GHO API returned a non-2xx status', { url, status: response.status });
      throw await httpErrorFromResponse(response, {
        service: 'GHO API',
        captureBody: false,
        // The default mapping sends 500/501 to InternalError, which is not transient —
        // adopting it verbatim would silently stop retrying those. Keep the whole 5xx
        // range retryable and let 4xx fall through to the fail-fast default mapping.
        codeOverride: (status) => (status >= 500 ? JsonRpcErrorCode.ServiceUnavailable : undefined),
        // httpErrorFromResponse seeds data.url from response.url; extraData spreads last,
        // so this suppresses it rather than relocating the leak from the message.
        data: { url: undefined },
      });
    }
    return this.parseJsonBody<T>(response);
  }

  /**
   * Internal: read a response body as JSON. The upstream serves an HTML error page
   * under some failure modes, so sniff for that first — otherwise it surfaces as a
   * JSON syntax error rather than as the service being unavailable.
   */
  private async parseJsonBody<T>(response: Response): Promise<T> {
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
