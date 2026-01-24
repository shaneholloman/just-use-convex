import { routeAgentRequest } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent"
import type { Env } from "./env.d.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeAgentRequest(request, env, {
        prefix: 'agent',
        cors: true,
      })) || new Response('Not found', { status: 404 })
    );
  },
};

export class Agent extends AIChatAgent<Env> {

  override async onStart(props?: Record<string, unknown> | undefined): Promise<void> {

    return super.onStart(props);
  }
}