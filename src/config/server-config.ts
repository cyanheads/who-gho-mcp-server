/**
 * @fileoverview Server-specific environment configuration for the WHO GHO MCP server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
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
    .describe('HTTP request timeout in milliseconds'),
});

let _config: z.infer<typeof ServerConfigSchema> | undefined;

export function getServerConfig() {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    baseUrl: 'GHO_BASE_URL',
    requestTimeoutMs: 'GHO_REQUEST_TIMEOUT_MS',
  });
  return _config;
}
