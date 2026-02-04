import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export class ScheduledJobWorkflow extends WorkflowEntrypoint<
  Cloudflare.Env,
  {
    prompt: string;
    label?: string | null;
    memberId?: string | null;
    agentName: string;
  }
> {
  async run(
    event: WorkflowEvent<{
      prompt: string;
      label?: string | null;
      memberId?: string | null;
      agentName: string;
    }>,
    step: WorkflowStep
  ) {
    const payload = event.payload;
    return await step.do("record", async () => ({
      timestamp: Date.now(),
      prompt: payload.prompt,
      label: payload.label ?? null,
      memberId: payload.memberId ?? null,
      agentName: payload.agentName,
    }));
  }
}
