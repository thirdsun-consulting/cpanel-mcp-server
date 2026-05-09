import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleUapiError, uapi } from "../services/client.js";
import { AccountSchema, FormatSchema, err, fmtBytes, formatResponse } from "../services/format.js";

export function registerEmailTools(server: McpServer) {
  server.registerTool(
    "cpanel_list_email_accounts",
    {
      title: "List Email Accounts",
      description: "List all POP/IMAP email accounts under the cPanel account, with disk usage and quota.",
      inputSchema: {
        domain: z.string().optional().describe("Filter to one domain"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Email",
          "list_pops_with_disk",
          { domain: params.domain },
          { account: params.account }
        );
        const accts = Array.isArray(data) ? data : data?.accounts ?? [];
        const md = [
          `# Email accounts (${accts.length})`,
          ...accts.map(
            (a: any) =>
              `- **${a.email}** — ${fmtBytes(a.diskused)} used / ${
                a._diskquota === "unlimited" || a.diskquota === "unlimited"
                  ? "unlimited"
                  : fmtBytes(a.diskquota ?? a._diskquota)
              } (${a.diskusedpercent ?? "n/a"}%)`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { accounts: accts });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_get_email_disk_usage",
    {
      title: "Get Email Disk Usage",
      description: "Get total disk usage across all email accounts on the cPanel account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Email", "get_main_account_disk_usage_bytes", {}, { account: params.account });
        return formatResponse(
          params.response_format,
          `Email disk usage: ${fmtBytes(data?.bytes ?? data)}`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_create_email_account",
    {
      title: "Create Email Account",
      description: "Create a new POP/IMAP email account.",
      inputSchema: {
        email: z.string().describe("Local part, e.g. 'support'"),
        domain: z.string(),
        password: z.string().min(8),
        quota: z.number().int().min(0).default(0).describe("Quota in MB; 0 = unlimited"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Email",
          "add_pop",
          {
            email: params.email,
            domain: params.domain,
            password: params.password,
            quota: params.quota,
          },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Created ${params.email}@${params.domain}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_email_account",
    {
      title: "Delete Email Account",
      description: "Delete an email account. Mailbox contents are deleted. Confirm with user.",
      inputSchema: {
        email: z.string(),
        domain: z.string(),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Email",
          "delete_pop",
          { email: params.email, domain: params.domain },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Deleted ${params.email}@${params.domain}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_change_email_password",
    {
      title: "Change Email Password",
      description: "Change the password for an email account.",
      inputSchema: {
        email: z.string(),
        domain: z.string(),
        password: z.string().min(8),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Email",
          "passwd_pop",
          { email: params.email, domain: params.domain, password: params.password },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Changed password for ${params.email}@${params.domain}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_set_email_quota",
    {
      title: "Set Email Quota",
      description: "Set or change the disk quota on an email account (in MB).",
      inputSchema: {
        email: z.string(),
        domain: z.string(),
        quota: z.number().int().min(0).describe("MB; 0 = unlimited"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Email",
          "edit_pop_quota",
          { email: params.email, domain: params.domain, quota: params.quota },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Set quota of ${params.email}@${params.domain} to ${params.quota} MB.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_list_email_forwarders",
    {
      title: "List Email Forwarders",
      description: "List email forwarders configured for the account.",
      inputSchema: {
        domain: z.string().optional(),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Email",
          "list_forwarders",
          { domain: params.domain },
          { account: params.account }
        );
        const items = Array.isArray(data) ? data : data?.forwarders ?? [];
        const md = [
          `# Email forwarders (${items.length})`,
          ...items.map((f: any) => `- ${f.dest ?? f.address ?? f.forward} → ${f.forward ?? f.destination}`),
        ].join("\n");
        return formatResponse(params.response_format, md, { forwarders: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}
