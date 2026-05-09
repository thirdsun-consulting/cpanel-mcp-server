import { CHARACTER_LIMIT, ResponseFormat } from "../constants.js";
import { z } from "zod";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: any;
  isError?: boolean;
}

export function ok(text: string, structured?: any): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured !== undefined ? { structuredContent: structured } : {}),
  };
}

export function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function formatResponse(
  format: ResponseFormat,
  markdown: string,
  structured: any
): ToolResult {
  let text =
    format === ResponseFormat.JSON ? JSON.stringify(structured, null, 2) : markdown;
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT - 200) +
      `\n\n[Response truncated at ${CHARACTER_LIMIT} characters.]`;
  }
  return ok(text, structured);
}

export function fmtBytes(bytes: number | string | undefined): string {
  const n = typeof bytes === "string" ? parseFloat(bytes) : bytes;
  if (n === undefined || n === null || isNaN(n as number)) return "n/a";
  const num = n as number;
  if (num < 1024) return `${num} B`;
  if (num < 1024 ** 2) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 ** 3) return `${(num / 1024 ** 2).toFixed(1)} MB`;
  return `${(num / 1024 ** 3).toFixed(2)} GB`;
}

// Common schema fragments
export const FormatSchema = {
  response_format: z
    .nativeEnum(ResponseFormat)
    .default(ResponseFormat.MARKDOWN)
    .describe("Output format"),
};

export const AccountSchema = {
  account: z
    .string()
    .optional()
    .describe(
      "Optional named account (from CPANEL_ACCOUNTS env). Omit to use single-account env (CPANEL_HOST/USER/TOKEN)."
    ),
};
