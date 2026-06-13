#!/usr/bin/env node
/**
 * @fileoverview who-gho-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { whoDimensionValuesResource } from './mcp-server/resources/definitions/who-dimension-values.resource.js';
import { whoIndicatorMetadataResource } from './mcp-server/resources/definitions/who-indicator-metadata.resource.js';
import { whoGetIndicatorMetadata } from './mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from './mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoListDimensions } from './mcp-server/tools/definitions/who-list-dimensions.tool.js';
import { whoListIndicators } from './mcp-server/tools/definitions/who-list-indicators.tool.js';
import { whoQueryIndicatorData } from './mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { whoSearchIndicators } from './mcp-server/tools/definitions/who-search-indicators.tool.js';
import { initGhoService } from './services/gho/gho-service.js';

await createApp({
  name: 'who-gho-mcp-server',
  title: 'who-gho-mcp-server',
  tools: [
    whoListDimensions,
    whoListDimensionValues,
    whoSearchIndicators,
    whoListIndicators,
    whoGetIndicatorMetadata,
    whoQueryIndicatorData,
  ],
  resources: [whoIndicatorMetadataResource, whoDimensionValuesResource],
  prompts: [],
  instructions:
    'WHO Global Health Observatory MCP server. Primary workflow: ' +
    '(1) who_search_indicators to find indicator codes by keyword, ' +
    '(2) who_get_indicator_metadata to confirm valid filter dimensions, ' +
    '(3) who_query_indicator_data to fetch data with country/region/year/sex filters. ' +
    'Use who_list_dimensions → who_list_dimension_values to discover valid filter codes.',
  setup(core) {
    initGhoService(core.config, core.storage);
  },
});
