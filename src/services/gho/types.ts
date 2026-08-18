/**
 * @fileoverview Domain types for the WHO GHO OData API.
 * @module services/gho/types
 */

/** Raw OData indicator entry from GET /Indicator */
export interface RawIndicator {
  IndicatorCode: string;
  IndicatorName: string;
  Language?: string;
}

/** Raw OData dimension type entry from GET /DIMENSION */
export interface RawDimension {
  Code: string;
  Title: string;
}

/** Raw OData dimension value entry from GET /DIMENSION/{code}/DimensionValues */
export interface RawDimensionValue {
  Code: string;
  Dimension?: string;
  ParentCode?: string;
  ParentDimension?: string;
  ParentTitle?: string;
  Title: string;
}

/** Raw OData IndicatorDimension entry from GET /IndicatorDimension */
export interface RawIndicatorDimension {
  Dimension: string;
  DimensionName: string;
  IndicatorCode: string;
  Language?: string;
}

/** Raw OData data row from GET /{IndicatorCode} */
export interface RawDataRow {
  Comments?: string | null;
  Date?: string;
  Dim1?: string;
  Dim1Type?: string;
  Dim2?: string;
  Dim2Type?: string;
  Dim3?: string;
  Dim3Type?: string;
  High?: number | null;
  Id?: number;
  IndicatorCode: string;
  Low?: number | null;
  NumericValue?: number | null;
  ParentLocation?: string | null;
  ParentLocationCode?: string | null;
  SpatialDim?: string;
  SpatialDimType?: string;
  TimeDim?: number;
  TimeDimType?: string;
  Value?: string | null;
}

/** OData envelope with an optional count */
export interface ODataEnvelope<T> {
  '@odata.count'?: number;
  value: T[];
}

/** Normalized indicator entry */
export interface Indicator {
  indicatorCode: string;
  indicatorName: string;
}

/** Normalized dimension type */
export interface Dimension {
  code: string;
  title: string;
}

/** Normalized dimension value */
export interface DimensionValue {
  code: string;
  label: string;
  parentCode?: string;
  parentDimension?: string;
  parentLabel?: string;
}

/** Normalized indicator-dimension cross-reference entry */
export interface IndicatorDimensionEntry {
  dimension: string;
  dimensionName: string;
}

/** Normalized data row */
export interface DataRow {
  comments?: string;
  dim1?: string;
  dim1Type?: string;
  dim2?: string;
  dim2Type?: string;
  displayValue?: string;
  high?: number;
  indicatorCode: string;
  low?: number;
  numericValue?: number;
  /** Name of the parent WHO region; absent when the row's own spatial entity is a region or aggregate. */
  parentLocation?: string;
  /** Code of the parent WHO region; absent alongside `parentLocation`. */
  parentLocationCode?: string;
  spatialDim?: string;
  spatialDimType?: string;
  year?: number;
}

/** Parameters for querying indicator data */
export interface DataQueryParams {
  countryCodes?: string[];
  dim1Value?: string;
  includeUncertainty: boolean;
  incomeGroupCodes?: string[];
  indicatorCode: string;
  limit: number;
  /** Zero-based row offset, sent as `$skip`. */
  offset: number;
  /**
   * OData `$orderby` clause, sent on every query. Required rather than optional so
   * `$skip` can never page over an order the upstream does not guarantee; it must end
   * in a unique key (`Id`) for the ordering to be total across page boundaries.
   */
  orderBy: string;
  regionCodes?: string[];
  sex?: string;
  yearFrom?: number;
  yearTo?: number;
}
