/**
 * @fileoverview Server-specific environment configuration for the WHO GHO MCP server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseConfig, parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

// Definitions choose their advertised bounds during module evaluation, before createApp.
parseConfig();

const ServerConfigSchema = z.object({
  clampLimits: z
    .stringbool()
    .default(true)
    .describe('Clamp oversized read limits to bounded pages'),
  baseUrl: z
    .string()
    .url()
    .default('https://ghoapi.azureedge.net/api/')
    .describe('GHO OData API base URL'),
  requestTimeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000)
    .describe(
      'Service operation deadline in milliseconds, including headers, body reads, retries and backoff',
    ),
});

let _config: z.infer<typeof ServerConfigSchema> | undefined;

export function getServerConfig() {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    clampLimits: 'GHO_CLAMP_LIMITS',
    baseUrl: 'GHO_BASE_URL',
    requestTimeoutMs: 'GHO_REQUEST_TIMEOUT_MS',
  });
  return _config;
}
