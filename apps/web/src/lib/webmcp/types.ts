/**
 * WebMCP browser integration types (based on W3C Community Group and Chrome origin trial specifications).
 */

export type WebMCPToolHints = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
};

export type WebMCPToolDefinition = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  hints?: WebMCPToolHints;
};

export type WebMCPExecutionContext = {
  signal?: AbortSignal;
};

export type WebMCPToolCallback = (
  input: Record<string, unknown>,
  context?: WebMCPExecutionContext
) => Promise<unknown> | unknown;

export type WebMCPToolRegistration = {
  unregister: () => void;
};

export interface WebMCPContext {
  registerTool(
    definition: WebMCPToolDefinition,
    callback: WebMCPToolCallback,
    options?: { signal?: AbortSignal }
  ): Promise<WebMCPToolRegistration> | WebMCPToolRegistration;
}

declare global {
  interface Document {
    modelContext?: WebMCPContext;
  }
  interface Window {
    modelContext?: WebMCPContext;
  }
  interface Navigator {
    modelContext?: WebMCPContext;
  }
}
