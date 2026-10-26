/** Subprocess probe: definitions must observe dotenv before constructing input schemas. */
import { z } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from '@/config/server-config.js';
import { whoDimensionValuesPageResource } from '@/mcp-server/resources/definitions/who-dimension-values.resource.js';
import { whoGetIndicatorMetadata } from '@/mcp-server/tools/definitions/who-get-indicator-metadata.tool.js';
import { whoListDimensionValues } from '@/mcp-server/tools/definitions/who-list-dimension-values.tool.js';
import { whoListIndicators } from '@/mcp-server/tools/definitions/who-list-indicators.tool.js';
import { whoQueryIndicatorData } from '@/mcp-server/tools/definitions/who-query-indicator-data.tool.js';
import { whoSearchIndicators } from '@/mcp-server/tools/definitions/who-search-indicators.tool.js';

process.stdout.write(
  JSON.stringify({
    clampLimits: getServerConfig().clampLimits,
    schemas: [
      whoSearchIndicators,
      whoListIndicators,
      whoListDimensionValues,
      whoQueryIndicatorData,
      whoGetIndicatorMetadata,
    ].map((definition) => z.toJSONSchema(definition.input)),
    resource: z.toJSONSchema(whoDimensionValuesPageResource.params!),
    accepts: [
      whoSearchIndicators.input.safeParse({ query: 'x', limit: 101 }).success,
      whoListIndicators.input.safeParse({ limit: 501 }).success,
      whoListDimensionValues.input.safeParse({ dimension: 'SEX', limit: 501 }).success,
      whoQueryIndicatorData.input.safeParse({ indicator_code: 'X', limit: 1001 }).success,
      whoGetIndicatorMetadata.input.safeParse({ indicator_codes: Array(11).fill('X') }).success,
      whoDimensionValuesPageResource.params!.safeParse({
        dimensionCode: 'SEX',
        limit: '501',
        offset: '0',
      }).success,
    ],
  }),
);
