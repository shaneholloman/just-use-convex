import alchemy from "alchemy";
import { Worker, DurableObjectNamespace, Container, WranglerJson, R2Bucket } from "alchemy/cloudflare";

const app = await alchemy("just-use-convex", {
  phase: process.argv.includes("--destroy") ? "destroy" : "up",
  password: process.env.ALCHEMY_PASSWORD
});

// Durable Object namespace for agent state with SQLite storage
const agentWorkerNamespace = DurableObjectNamespace("agent-worker", {
  className: "AgentWorker",
  sqlite: true,
});

// Sandbox container for code execution (exported from index.ts)
// Type parameter matches the Sandbox class exported from @cloudflare/sandbox
// Image version must match @cloudflare/sandbox npm package version (0.7.0)
const sandboxContainer = await Container<import("@cloudflare/sandbox").Sandbox>("sandbox", {
  className: "Sandbox",
  image: "docker.io/cloudflare/sandbox:0.7.0",
});

// R2 bucket for persistent workspace storage
const workspaceBucket = await R2Bucket("just-use-convex-workspaces", {
  name: "just-use-convex-workspaces",
});

// Deploy the agent worker
export const worker = await Worker("agent-worker", {
  entrypoint: "./src/index.ts",
  url: false,
  compatibility: "node",
  bindings: {
    agentWorker: agentWorkerNamespace,
    Sandbox: sandboxContainer,
    WORKSPACE_BUCKET: workspaceBucket,
    CONVEX_URL: alchemy.secret(process.env.CONVEX_URL),
    CONVEX_SITE_URL: alchemy.secret(process.env.CONVEX_SITE_URL),
    SITE_URL: alchemy.secret(process.env.SITE_URL || "http://localhost:3001"),
    OPENROUTER_API_KEY: alchemy.secret(process.env.OPENROUTER_API_KEY),
    OPENROUTER_MODEL: alchemy.secret(process.env.OPENROUTER_MODEL || "openai/gpt-5.2-chat"),
    COMPOSIO_API_KEY: alchemy.secret(process.env.COMPOSIO_API_KEY || ''),
    VOLTAGENT_OBSERVABILITY_ENABLED: alchemy.secret(process.env.VOLTAGENT_OBSERVABILITY_ENABLED || 'true'),
    VOLTAGENT_PUBLIC_KEY: alchemy.secret(process.env.VOLTAGENT_PUBLIC_KEY || ''),
    VOLTAGENT_SECRET_KEY: alchemy.secret(process.env.VOLTAGENT_SECRET_KEY || ''),
    EXA_API_KEY: alchemy.secret(process.env.EXA_API_KEY || ''),
    R2_ENDPOINT: alchemy.secret(process.env.R2_ENDPOINT || ''),
    R2_ACCESS_KEY_ID: alchemy.secret(process.env.R2_ACCESS_KEY_ID || ''),
    R2_SECRET_ACCESS_KEY: alchemy.secret(process.env.R2_SECRET_ACCESS_KEY || ''),
  },
  observability: {
    logs: {
      enabled: true,
      invocationLogs: true,
    }
  }
});

await app.finalize();

await WranglerJson({
  worker: worker,
  path: "./wrangler.json",
});