import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleUapiError, uapi } from "../services/client.js";
import { AccountSchema, FormatSchema, err, formatResponse } from "../services/format.js";

export function registerDomainTools(server: McpServer) {
  server.registerTool(
    "cpanel_list_domains",
    {
      title: "List All Domains",
      description: "List the main domain plus all subdomains, addon domains, and parked domains for the account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("DomainInfo", "list_domains", {}, { account: params.account });
        const md = [
          `# Domains`,
          `- Main: ${data.main_domain}`,
          `- Subdomains: ${(data.sub_domains ?? []).join(", ") || "(none)"}`,
          `- Addon: ${(data.addon_domains ?? []).join(", ") || "(none)"}`,
          `- Parked: ${(data.parked_domains ?? []).join(", ") || "(none)"}`,
        ].join("\n");
        return formatResponse(params.response_format, md, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_list_addon_domains",
    {
      title: "List Addon Domains",
      description: "List addon domains with full info (document root, subdomain it maps to, etc.).",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("AddonDomain", "list_addon_domains", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.domains ?? [];
        const md = [
          `# Addon domains (${items.length})`,
          ...items.map(
            (d: any) =>
              `- **${d.domain}** → ${d.subdomain ?? d.subdomain_full ?? ""} (root: ${d.dir ?? d.docroot ?? ""})`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { domains: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_list_subdomains",
    {
      title: "List Subdomains",
      description: "List subdomains of all domains owned by the account.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("SubDomain", "list_subdomains", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.subdomains ?? [];
        const md = [
          `# Subdomains (${items.length})`,
          ...items.map((d: any) => `- **${d.domain}** (root: ${d.dir ?? d.docroot ?? ""})`),
        ].join("\n");
        return formatResponse(params.response_format, md, { subdomains: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_list_parked_domains",
    {
      title: "List Parked Domains",
      description: "List parked (aliased) domains.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Park", "list_parked_domains", {}, { account: params.account });
        const items = Array.isArray(data) ? data : data?.domains ?? [];
        const md = [
          `# Parked domains (${items.length})`,
          ...items.map((d: any) => `- ${d.domain ?? d}`),
        ].join("\n");
        return formatResponse(params.response_format, md, { domains: items });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_create_addon_domain",
    {
      title: "Create Addon Domain",
      description: "Create a new addon domain on the account.",
      inputSchema: {
        domain: z.string(),
        subdomain: z.string().describe("Subdomain prefix to map (e.g. 'addon-newsite')"),
        dir: z.string().optional().describe("Document root directory"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "AddonDomain",
          "addaddondomain",
          { domain: params.domain, subdomain: params.subdomain, dir: params.dir },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Created addon domain ${params.domain}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_addon_domain",
    {
      title: "Delete Addon Domain",
      description: "Delete an addon domain. Confirm with user.",
      inputSchema: {
        domain: z.string(),
        subdomain: z.string().describe("The subdomain that backs the addon (e.g. 'addon_newsite.example.com')"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "AddonDomain",
          "deladdondomain",
          { domain: params.domain, subdomain: params.subdomain },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Deleted addon domain ${params.domain}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_create_subdomain",
    {
      title: "Create Subdomain",
      description: "Create a subdomain on a root domain.",
      inputSchema: {
        domain: z.string().describe("Subdomain prefix, e.g. 'blog'"),
        rootdomain: z.string().describe("Root domain, e.g. 'example.com'"),
        dir: z.string().optional().describe("Document root"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "SubDomain",
          "addsubdomain",
          { domain: params.domain, rootdomain: params.rootdomain, dir: params.dir },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Created subdomain ${params.domain}.${params.rootdomain}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_subdomain",
    {
      title: "Delete Subdomain",
      description: "Delete a subdomain. Confirm with user.",
      inputSchema: {
        domain: z.string().describe("Full subdomain, e.g. 'blog.example.com'"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "SubDomain",
          "delsubdomain",
          { domain: params.domain },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Deleted subdomain ${params.domain}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}
