# cpanel-mcp-server

MCP server for cPanel UAPI — per-account ops focused on app monitoring, error investigation, and improvement workflows. Pairs with `whm-mcp-server` for server-wide views.

## What's covered

| Area | Tools |
|------|-------|
| Domains | `list_domains`, `list_addon_domains`, `list_subdomains`, `list_parked_domains`, `create_addon_domain`, `delete_addon_domain`, `create_subdomain`, `delete_subdomain` |
| Email | `list_email_accounts`, `get_email_disk_usage`, `create_email_account`, `delete_email_account`, `change_email_password`, `set_email_quota`, `list_email_forwarders` |
| Databases | `list_databases`, `list_database_users`, `create_database`, `delete_database`, `create_database_user`, `delete_database_user`, `grant_database_privileges`, `revoke_database_privileges` |
| **Monitoring** | **`get_error_log`**, `list_logs`, **`get_resource_usage`** (LVE), `get_account_stats`, `get_disk_usage_breakdown`, `get_bandwidth` |
| Cron | `list_cron_jobs`, `add_cron_job`, `delete_cron_job`, `get_cron_email` |
| FTP | `list_ftp_accounts`, `create_ftp_account`, `delete_ftp_account` |
| SSL | `list_ssl_certs`, `install_ssl` |
| PHP | `get_php_version`, `set_php_version`, `list_installed_php_versions` |

The headline tools for "partner in improving + error monitoring" are `cpanel_get_error_log` (PHP fatals, mod_security blocks, app crashes) and `cpanel_get_resource_usage` (LVE: when a site is slow because the account hit its CPU/EP/MEM ceiling).

All tools are prefixed `cpanel_*`. Read-only tools marked `readOnlyHint: true`. Destructive ops (`delete_*`, `revoke_*`, `set_php_version` because it impacts vhost config) marked `destructiveHint: true`.

## Install

```bash
git clone <your-fork-url> cpanel-mcp-server
cd cpanel-mcp-server
npm install
npm run build
```

## Authentication — two modes

### Single account

```bash
export CPANEL_HOST="cpanel.example.com"
export CPANEL_USER="myuser"
export CPANEL_TOKEN="your-token"
export CPANEL_PORT="2083"             # default
# Self-signed cert?
# export CPANEL_INSECURE_TLS="true"
```

### Multi-account

If you manage several cPanel accounts (or multiple hosts), define them all in one JSON env var, then pass `account: '<name>'` to any tool:

```bash
export CPANEL_ACCOUNTS='{
  "alpha": {"host":"srv1.example.com","user":"alpha","token":"tok_a","port":2083},
  "beta":  {"host":"srv1.example.com","user":"beta", "token":"tok_b"},
  "gamma": {"host":"srv2.example.com","user":"gamma","token":"tok_g","insecureTls":true}
}'
```

Then call e.g. `cpanel_get_error_log` with `{ account: "alpha" }`. Omit `account` to use single-account env vars (so you can mix both modes).

If `CPANEL_ACCOUNTS` is not valid JSON, or an entry lacks `host`, `user` or `token`, the server says so on stderr at startup and in the error of any tool call that names the affected account. These messages name the account and the field, never the token.

Get tokens in cPanel → Security → Manage API Tokens (per cPanel account).

## Run

```bash
npm start
```

## Test interactively

```bash
npm run inspect
```

## Verify

```bash
npm run build && npm run verify:mock
```

Drives every tool through a real MCP client against a mock UAPI endpoint (needs the `openssl` CLI for a throwaway certificate). It checks that results are accepted whatever shape cPanel's reply has, that a failed call is reported with cPanel's reason, that `CPANEL_ACCOUNTS` problems are reported, and that secrets never appear in a URL. It does not check that the UAPI functions and parameters the tools use exist; that needs cPanel's OpenAPI spec and has not been done yet.

## Wire to MCP client

```json
{
  "mcpServers": {
    "cpanel": {
      "command": "node",
      "args": ["/absolute/path/to/cpanel-mcp-server/dist/index.js"],
      "env": {
        "CPANEL_ACCOUNTS": "{...}"
      }
    }
  }
}
```

## License

MIT
