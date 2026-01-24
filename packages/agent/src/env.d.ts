import type { DurableObjectNamespace } from "@cloudflare/workers-types";

export interface Env {
  AGENT_STATE: DurableObjectNamespace;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
}
