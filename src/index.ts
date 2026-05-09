#!/usr/bin/env node
/**
 * cPanel MCP Server
 *
 * Exposes cPanel UAPI per-account ops as MCP tools: domains, email,
 * databases, cron, FTP, SSL, PHP, and (critically) error log/resource usage
 * monitoring.
 *
 * Auth modes:
 *
 * 1) Single-account (env vars):
 *    CPANEL_HOST, CPANEL_USER, CPANEL_TOKEN, CPANEL_PORT (default 2083),
 *    CPANEL_INSECURE_TLS=true to skip TLS verification.
 *
 * 2) Multi-account (env var):
 *    CPANEL_ACCOUNTS='{"alpha":{"host":"...","user":"...","token":"...","port":2083},
 *                     "beta":{"host":"...","user":"...","token":"..."}}'
 *    Pass `account: 'alpha'` (or 'beta') to any tool to choose.
 *
 * Get a token in cPanel → Security → Manage API Tokens.
 *
 * Transport: stdio.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerDomainTools } from "./tools/domains.js";
import { registerEmailTools } from "./tools/email.js";
import { registerDatabaseTools } from "./tools/databases.js";
import { registerMonitoringTools } from "./tools/monitoring.js";
import {
  registerCronTools,
  registerFtpTools,
  registerSslTools,
  registerPhpTools,
} from "./tools/misc.js";
import { listConfiguredAccounts } from "./services/client.js";

async function main() {
  const server = new McpServer({
    name: "cpanel-mcp-server",
    version: "0.1.0",
  });

  registerDomainTools(server);
  registerEmailTools(server);
  registerDatabaseTools(server);
  registerMonitoringTools(server);
  registerCronTools(server);
  registerFtpTools(server);
  registerSslTools(server);
  registerPhpTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const accounts = listConfiguredAccounts();
  process.stderr.write(
    `cpanel-mcp-server: listening on stdio${
      accounts.length ? ` (multi-account mode: ${accounts.join(", ")})` : ""
    }\n`
  );
}

main().catch((err) => {
  process.stderr.write(`cpanel-mcp-server: fatal error: ${err?.stack ?? err}\n`);
  process.exit(1);
});
