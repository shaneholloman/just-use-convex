import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { env } from "@just-use-convex/env/web";

type AgentChatOptions = {
  agentType?: string;
  host?: string;
  credentials?: RequestCredentials;
  onError?: (error: Error) => void;
};

type AgentChatInstance = ReturnType<typeof useAgentChat>;

type AgentChatStore = {
  instances: Map<string, AgentChatInstance>;
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => Map<string, AgentChatInstance>;
  set: (key: string, instance: AgentChatInstance) => void;
  get: (key: string) => AgentChatInstance | undefined;
};

function createAgentChatStore(): AgentChatStore {
  const instances = new Map<string, AgentChatInstance>();
  const listeners = new Set<() => void>();

  return {
    instances,
    subscribe: (callback: () => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getSnapshot: () => instances,
    set: (key: string, instance: AgentChatInstance) => {
      instances.set(key, instance);
      listeners.forEach((listener) => listener());
    },
    get: (key: string) => instances.get(key),
  };
}

const AgentChatStoreContext = createContext<AgentChatStore | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
  const store = createAgentChatStore();

  return (
    <AgentChatStoreContext.Provider value={store}>
      {children}
    </AgentChatStoreContext.Provider>
  );
}

function useAgentChatStore() {
  const store = useContext(AgentChatStoreContext);
  if (!store) {
    throw new Error("useAgentChat must be used within an AgentsProvider");
  }
  return store;
}

type UseAgentChatOptions = AgentChatOptions & {
  name: string;
};

/**
 * Hook to get or create an agent chat instance.
 * Uses a getOrCreate pattern - if an instance with the given name exists, it returns it.
 * Otherwise, it creates a new instance and stores it.
 *
 * @param options.name - Unique identifier for this agent chat instance
 * @param options.agentType - The agent type (default: "agent")
 * @param options.host - The agent host URL (default: env.VITE_AGENT_URL)
 * @param options.credentials - Request credentials (default: "include")
 * @param options.onError - Error callback
 */
export function useAgentChatInstance(options: UseAgentChatOptions) {
  const { name, agentType = "agent", host = env.VITE_AGENT_URL, credentials = "include", onError } = options;

  const store = useAgentChatStore();

  const instances = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  const agent = useAgent({
    agent: agentType,
    name,
    host,
  });

  const chat = useAgentChat({
    agent,
    credentials,
    onError,
  });

  // Register instance if not already registered
  const existingInstance = instances.get(name);
  if (!existingInstance && agent) {
    store.set(name, chat);
  }

  const getInstance = useCallback(
    (instanceName: string) => store.get(instanceName),
    [store]
  );

  return {
    ...chat,
    agent,
    getInstance,
    isConnected: !!agent,
  };
}

/**
 * Hook to access an existing agent chat instance by name.
 * Returns undefined if the instance doesn't exist.
 */
export function useExistingAgentChat(name: string) {
  const store = useAgentChatStore();

  const instances = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  return instances.get(name);
}

/**
 * Hook to get all active agent chat instance names.
 */
export function useAgentChatInstances() {
  const store = useAgentChatStore();

  const instances = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );

  return Array.from(instances.keys());
}
