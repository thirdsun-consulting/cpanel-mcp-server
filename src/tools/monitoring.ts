import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleUapiError, uapi } from "../services/client.js";
import { AccountSchema, FormatSchema, err, fmtBytes, formatResponse } from "../services/format.js";

/**
 * The user emphasized "error monitoring" — these are the most important tools.
 */
export function registerMonitoringTools(server: McpServer) {
  // ---- get_error_log (THE BIG ONE) ----
  server.registerTool(
    "cpanel_get_error_log",
    {
      title: "Get cPanel Error Log",
      description:
        "Get the most recent entries from the cPanel error_log. THE PRIMARY TOOL for diagnosing application errors, " +
        "PHP fatals, mod_security blocks, etc. for an account.",
      inputSchema: {
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        // No fallback: a failure here must reach the caller with cPanel's own
        // reason. Substituting another call's output made a failed lookup
        // look like an empty error log.
        const data: any = await uapi(
          "LogManager",
          "list_logs_by_type",
          { type: "error_log" },
          { account: params.account }
        );
        return formatResponse(
          params.response_format,
          `# Error log\n\`\`\`\n${
            typeof data === "string"
              ? data
              : data?.log ?? data?.errlog ?? JSON.stringify(data, null, 2)
          }\n\`\`\``,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  // ---- list_logs (find which logs are available) ----
  server.registerTool(
    "cpanel_list_logs",
    {
      title: "List Available Logs",
      description: "List the log files available for this cPanel account (error logs, access logs, ftp, mail).",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("LogManager", "list_logs_metadata", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.logs ?? [];
        const md = [
          `# Available logs (${items.length})`,
          ...items.map(
            (l: any) => `- **${l.type ?? l.name}** (${l.path ?? "n/a"}) — ${fmtBytes(l.size ?? l.bytes)}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { logs: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  // ---- get_resource_usage (LVE — the gold) ----
  server.registerTool(
    "cpanel_get_resource_usage",
    {
      title: "Get LVE Resource Usage",
      description:
        "Get LVE resource usage metrics: CPU, memory, IO, entry processes (concurrent connections), faults. " +
        "If 'cpu_usage' or 'mem_limit' is high, that's why the site is slow. Use this as the FIRST tool when investigating performance.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("ResourceUsage", "get_usages", {}, { account: params.account });
        const usages = Array.isArray(data) ? data : data?.usage ?? [];
        const md = [
          `# LVE resource usage`,
          ...usages.map(
            (u: any) =>
              `- **${u.id ?? u.name}**: ${u.formatted ?? `${u.usage}/${u.maximum} ${u.unit ?? ""}`} (${u.usage_pct ?? ""}%)${
                u.faults ? ` — faults: ${u.faults}` : ""
              }`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { usage: usages });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  // ---- get_stats (StatsBar) ----
  server.registerTool(
    "cpanel_get_account_stats",
    {
      title: "Get Account Stats",
      description:
        "Get high-level account stats: disk used, bandwidth, addon/sub/parked counts, email count, db count. Snapshot of everything.",
      inputSchema: {
        display: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of stat keys (e.g. 'diskusage|bandwidthusage|addondomains'). Omit for all defaults."
          ),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "StatsBar",
          "get_stats",
          { display: params.display ?? "diskusage|bandwidthusage|addondomains|subdomains|parkeddomains|hostingpackage|emailaccounts|mysqldiskusage|sqldatabases" },
          { account: params.account }
        );
        const stats = Array.isArray(data) ? data : data?.stats ?? [];
        const md = [
          `# Account stats`,
          ...stats.map((s: any) => `- **${s.name}**: ${s.formatted ?? s.value}`),
        ].join("\n");
        return formatResponse(params.response_format, md, { stats });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  // ---- get_disk_usage breakdown ----
  server.registerTool(
    "cpanel_get_disk_usage_breakdown",
    {
      title: "Get Disk Usage Breakdown",
      description: "Get disk usage broken down by directory under the account home dir.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Quota", "get_quota_info", {}, { account: params.account });
        return formatResponse(
          params.response_format,
          `# Disk usage\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  // ---- bandwidth ----
  server.registerTool(
    "cpanel_get_bandwidth",
    {
      title: "Get Bandwidth Usage",
      description: "Get monthly bandwidth usage broken down by month.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Bandwidth", "query", {}, { account: params.account });
        return formatResponse(
          params.response_format,
          `# Bandwidth\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}
