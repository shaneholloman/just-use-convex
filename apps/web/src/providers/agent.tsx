import { useAgent } from "agents/react";
import { authClient } from "@/lib/auth-client";
import { createContext, useContext } from "react";

const AGENT_URL = import.meta.env.VITE_AGENT_URL

type AgentContext = {
  agents: Record<string, ReturnType<typeof useAgent>>
}

const AgentContext = createContext<AgentContext>({
  agents: {},
});

export function useAgentContext() {
  return useContext(AgentContext);
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = authClient.useSession();
  const token = session?.session.token;
  const organizationId = session?.session.activeOrganizationId;
  const userId = session?.session.userId;

  return <AgentContext.Provider value={{ organizationId: "", agents: {} }}>{children}</AgentContext.Provider>;
}
