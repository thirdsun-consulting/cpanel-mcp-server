import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleUapiError, uapi } from "../services/client.js";
import { AccountSchema, FormatSchema, err, fmtBytes, formatResponse } from "../services/format.js";

export function registerDatabaseTools(server: McpServer) {
  server.registerTool(
    "cpanel_list_databases",
    {
      title: "List MySQL Databases",
      description: "List all MySQL databases on the cPanel account with their sizes.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Mysql", "list_databases", {}, { account: params.account });
        const dbs = Array.isArray(data) ? data : data?.databases ?? [];
        const md = [
          `# MySQL databases (${dbs.length})`,
          ...dbs.map(
            (d: any) =>
              `- **${d.database}** — ${fmtBytes(d.disk_usage ?? d.size ?? 0)}, users: ${
                Array.isArray(d.users) ? d.users.join(", ") : d.user_count ?? "n/a"
              }`
          ),
        ].join("\n");
        return formatResponse(params.response_format, md, { databases: dbs });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_list_database_users",
    {
      title: "List MySQL Users",
      description: "List MySQL users on the cPanel account and their database privileges.",
      inputSchema: { ...AccountSchema, ...FormatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi("Mysql", "list_users", {}, { account: params.account });
        const users = Array.isArray(data) ? data : data?.users ?? [];
        const md = [
          `# MySQL users (${users.length})`,
          ...users.map((u: any) => `- ${u.user ?? u}`),
        ].join("\n");
        return formatResponse(params.response_format, md, { users });
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_create_database",
    {
      title: "Create MySQL Database",
      description: "Create a new MySQL database. cPanel will prefix it with the cPanel username automatically.",
      inputSchema: {
        name: z.string().describe("DB name (without the cPanel username prefix)"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Mysql",
          "create_database",
          { name: params.name },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Created database ${params.name}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_database",
    {
      title: "Delete MySQL Database",
      description: "PERMANENTLY DELETE a MySQL database and all its data. Confirm with user.",
      inputSchema: {
        name: z.string(),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Mysql",
          "delete_database",
          { name: params.name },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Deleted database ${params.name}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_create_database_user",
    {
      title: "Create MySQL User",
      description: "Create a new MySQL user. cPanel prefixes the username automatically.",
      inputSchema: {
        name: z.string(),
        password: z.string().min(8),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Mysql",
          "create_user",
          { name: params.name, password: params.password },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Created MySQL user ${params.name}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_delete_database_user",
    {
      title: "Delete MySQL User",
      description: "Delete a MySQL user. Confirm with user.",
      inputSchema: {
        name: z.string(),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Mysql",
          "delete_user",
          { name: params.name },
          { account: params.account, method: "POST" }
        );
        return formatResponse(params.response_format, `Deleted MySQL user ${params.name}.`, data);
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_grant_database_privileges",
    {
      title: "Grant DB Privileges",
      description: "Grant a MySQL user access to a database.",
      inputSchema: {
        user: z.string(),
        database: z.string(),
        privileges: z
          .string()
          .default("ALL PRIVILEGES")
          .describe("Comma-separated MySQL privs, default 'ALL PRIVILEGES'"),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Mysql",
          "set_privileges_on_database",
          { user: params.user, database: params.database, privileges: params.privileges },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Granted ${params.privileges} on ${params.database} to ${params.user}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );

  server.registerTool(
    "cpanel_revoke_database_privileges",
    {
      title: "Revoke DB Privileges",
      description: "Revoke a MySQL user's access from a database.",
      inputSchema: {
        user: z.string(),
        database: z.string(),
        ...AccountSchema,
        ...FormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data: any = await uapi(
          "Mysql",
          "revoke_access_to_database",
          { user: params.user, database: params.database },
          { account: params.account, method: "POST" }
        );
        return formatResponse(
          params.response_format,
          `Revoked ${params.user}'s access to ${params.database}.`,
          data
        );
      } catch (e) {
        return err(handleUapiError(e));
      }
    }
  );
}
