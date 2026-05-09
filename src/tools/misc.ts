import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleUapiError, uapi } from "../services/client.js";
import { AccountSchema, FormatSchema, err, formatResponse } from "../services/format.js";

export function registerCronTools(server: McpServer) {
  server.registerTool(
    "cpanel_list_cron_jobs",
    {
      title: "List Cron Jobs",
      description: "List all cron jobs configured on the cPanel account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Cron", "list_jobs", {}, { account: params.account });
        const jobs = Array.isArray(data) ? data : data?.jobs ?? [];
        const md = [
          `# Cron jobs (${jobs.length})`,
          ...jobs.map(
            (j: any, i: number) =>
              `${i + 1}. (id ${j.linekey ?? j.id ?? i}) \`${j.minute} ${j.hour} ${j.day} ${j.month} ${j.weekday}\` → ${j.command}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { jobs });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_add_cron_job",
    {
      title: "Add Cron Job",
      description: "Add a new cron job. Use cron syntax: minute hour day month weekday.",
      inputSchema: {
        minute: z.string().default("*"),
        hour: z.string().default("*"),
        day: z.string().default("*"),
        month: z.string().default("*"),
        weekday: z.string().default("*"),
        command: z.string(),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, account, ...rest } = params;
        const data: any = await uapi("Cron", "add_line", rest, { account, method: "POST" });
        return formatResponse(response_format, `Added cron job: ${rest.command}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_cron_job",
    {
      title: "Delete Cron Job",
      description: "Delete a cron job by its line key (from list_cron_jobs).",
      inputSchema: {
        linekey: z.string().describe("The 'linekey' from list_cron_jobs"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Cron",
          "remove_line",
          { linekey: params.linekey },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Deleted cron job ${params.linekey}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_get_cron_email",
    {
      title: "Get Cron Email Address",
      description: "Get the email address that receives cron job output.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Cron", "get_email", {}, { account: params.account });
        return formatResponse(
          params.response_format,
          `Cron email: ${data?.email ?? data ?? "(not set)"}`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}

export function registerFtpTools(server: McpServer) {
  server.registerTool(
    "cpanel_list_ftp_accounts",
    {
      title: "List FTP Accounts",
      description: "List FTP accounts on the cPanel account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Ftp", "list_ftp", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.accounts ?? [];
        const md = [
          `# FTP accounts (${items.length})`,
          ...items.map((a: any) => `- ${a.user} (home: ${a.dir ?? a.homedir})`),
        ].join("\n");
        return formatResponse(params.response_format, md, { accounts: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_create_ftp_account",
    {
      title: "Create FTP Account",
      description: "Create a new FTP account.",
      inputSchema: {
        user: z.string(),
        pass: z.string().min(8),
        homedir: z.string().describe("Relative to public_html, e.g. 'subdir'"),
        quota: z.number().int().min(0).default(0).describe("Quota in MB; 0 = unlimited"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, account, ...rest } = params;
        const data: any = await uapi("Ftp", "add_ftp", rest, { account, method: "POST" });
        return formatResponse(response_format, `Created FTP account ${rest.user}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_ftp_account",
    {
      title: "Delete FTP Account",
      description: "Delete an FTP account. Confirm with user.",
      inputSchema: {
        user: z.string(),
        destroy: z
          .boolean()
          .default(false)
          .describe("If true, also delete the user's home directory"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Ftp",
          "delete_ftp",
          { user: params.user, destroy: params.destroy },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Deleted FTP account ${params.user}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}

export function registerSslTools(server: McpServer) {
  server.registerTool(
    "cpanel_list_ssl_certs",
    {
      title: "List SSL Certificates",
      description: "List installed SSL certificates on this cPanel account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("SSL", "list_ssl_items", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.certs ?? data?.items ?? [];
        const md = [
          `# SSL items (${items.length})`,
          ...items.map(
            (c: any) =>
              `- ${c.domains ?? c.domain ?? c.id} — issuer: ${c.issuer?.commonName ?? c.issuer ?? "n/a"}, expires: ${c.not_after ?? c.notAfter ?? "n/a"}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_install_ssl",
    {
      title: "Install SSL Certificate",
      description: "Install an SSL certificate for a domain on this account.",
      inputSchema: {
        domain: z.string(),
        cert: z.string().describe("PEM-encoded certificate"),
        key: z.string().describe("PEM-encoded private key"),
        cabundle: z.string().optional().describe("Optional CA bundle"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { response_format, account, ...rest } = params;
        const data: any = await uapi("SSL", "install_ssl", rest, { account, method: "POST" });
        return formatResponse(response_format, `Installed SSL on ${rest.domain}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}

export function registerPhpTools(server: McpServer) {
  server.registerTool(
    "cpanel_get_php_version",
    {
      title: "Get PHP Versions per Domain",
      description: "Get the PHP version configured for each vhost (domain) on the account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("LangPHP", "php_get_vhost_versions", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.vhosts ?? [];
        const md = [
          `# PHP versions per vhost (${items.length})`,
          ...items.map(
            (v: any) =>
              `- ${v.vhost ?? v.domain}: **${v.version ?? v.phpversion}**${v.is_inherit ? " (inherited)" : ""}`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { vhosts: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_set_php_version",
    {
      title: "Set PHP Version for Domain",
      description: "Change the PHP version for one or more vhosts.",
      inputSchema: {
        vhost: z.string().describe("Domain (vhost)"),
        version: z.string().describe("PHP version label, e.g. 'ea-php82'"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "LangPHP",
          "php_set_vhost_versions",
          { "vhost-0": params.vhost, version: params.version },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Set ${params.vhost} to PHP ${params.version}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_list_installed_php_versions",
    {
      title: "List Installed PHP Versions",
      description: "List the PHP versions available on the server.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("LangPHP", "php_get_installed_versions", {}, { account: params.account });
        const versions = Array.isArray(data) ? data : data?.versions ?? [];
        const md = `# Installed PHP versions (${versions.length})\n${versions.map((v: any) => `- ${v}`).join("\n")}`;
        return formatResponse(params.response_format, md, { versions });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}
