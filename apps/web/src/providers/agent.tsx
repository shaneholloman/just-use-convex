import type { ChatSettings } from "@/components/chat";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { env } from "@just-use-convex/env/web";
import { useAgent } from "agents/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  useSyncExternalStore,
  useRef,
  type ReactNode,
} from "react";

type AgentChatInstance = ReturnType<typeof useAgentChat>;

type InstanceData = {
  chat: AgentChatInstance | null;
  settings: ChatSettings;
  setSettings: (settingsOrFn: ChatSettings | ((prev: ChatSettings) => ChatSettings)) => void;
};

type AgentsContextValue = {
  requestInstance: (chatId: string) => void;
  subscribe: (chatId: string, callback: () => void) => () => void;
  getSnapshot: (chatId: string) => InstanceData | undefined;
};

const AgentsContext = createContext<AgentsContextValue | null>(null);

// Individual agent instance component that maintains the connection
function AgentInstance({
  chatId,
  onUpdate,
}: {
  chatId: string;
  onUpdate: (chatId: string, data: InstanceData) => void;
}) {
  const [settings, setSettingsState] = useState<ChatSettings>({});

  const handleStateUpdate = useCallback(
    (state: ChatSettings | undefined, source: string) => {
      if (source === "server" && state) {
        setSettingsState(state);
      }
    },
    []
  );

  const handleError = useCallback((error: Error) => {
    console.error("Chat error:", error);
  }, []);

  const setSettings = useCallback(
    (settingsOrFn: ChatSettings | ((prev: ChatSettings) => ChatSettings)) => {
      setSettingsState((prev: ChatSettings) =>
        typeof settingsOrFn === "function" ? settingsOrFn(prev) : settingsOrFn
      );
    },
    []
  );

  // Refs to hold current values for onMessage callback
  const chatRef = useRef<AgentChatInstance | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Notify subscribers when messages arrive
  const handleMessage = useCallback(() => {
    onUpdate(chatId, {
      chat: chatRef.current,
      settings: settingsRef.current,
      setSettings,
    });
  }, [chatId, onUpdate, setSettings]);

  const agent = useAgent<ChatSettings>({
    agent: "agent-worker",
    name: `chat-${chatId}`,
    host: env.VITE_AGENT_URL,
    onStateUpdate: handleStateUpdate,
    onMessage: handleMessage,
  });

  const chat = useAgentChat({
    agent,
    credentials: "include",
    resume: true,
    onError: handleError,
  });

  // Keep chatRef in sync
  chatRef.current = chat;

  // Initial registration and settings sync
  useEffect(() => {
    onUpdate(chatId, { chat, settings, setSettings });
  }, [chatId, chat, settings, setSettings, onUpdate]);

  return null;
}

export function AgentsProvider({ children }: { children: ReactNode }) {
  const instanceDataRef = useRef<Map<string, InstanceData>>(new Map());
  const subscribersRef = useRef<Map<string, Set<() => void>>>(new Map());

  // Store active chat IDs and render elements dynamically
  const [activeIds, setActiveIds] = useState<string[]>([]);

  const handleInstanceUpdate = useCallback((chatId: string, data: InstanceData) => {
    instanceDataRef.current.set(chatId, data);
    subscribersRef.current.get(chatId)?.forEach((cb) => cb());
  }, []);

  const requestInstance = useCallback((chatId: string) => {
    setActiveIds((prev) => {
      if (prev.includes(chatId)) return prev;
      return [...prev, chatId];
    });
  }, []);

  const subscribe = useCallback((chatId: string, callback: () => void) => {
    if (!subscribersRef.current.has(chatId)) {
      subscribersRef.current.set(chatId, new Set());
    }
    subscribersRef.current.get(chatId)!.add(callback);

    return () => {
      subscribersRef.current.get(chatId)?.delete(callback);
    };
  }, []);

  const getSnapshot = useCallback((chatId: string) => {
    return instanceDataRef.current.get(chatId);
  }, []);

  const value = useMemo<AgentsContextValue>(
    () => ({
      requestInstance,
      subscribe,
      getSnapshot,
    }),
    [requestInstance, subscribe, getSnapshot]
  );

  return (
    <AgentsContext.Provider value={value}>
      {activeIds.map((id) => (
        <AgentInstance
          key={id}
          chatId={id}
          onUpdate={handleInstanceUpdate}
        />
      ))}
      {children}
    </AgentsContext.Provider>
  );
}

export function useAgentsContext() {
  const context = useContext(AgentsContext);
  if (!context) {
    throw new Error("useAgentsContext must be used within an AgentsProvider");
  }
  return context;
}

export function useAgentInstance(chatId: string) {
  const { requestInstance, subscribe, getSnapshot } = useAgentsContext();

  // Request the instance on mount
  useEffect(() => {
    requestInstance(chatId);
  }, [chatId, requestInstance]);

  // Subscribe to updates using useSyncExternalStore
  const subscribeToChat = useCallback(
    (callback: () => void) => subscribe(chatId, callback),
    [chatId, subscribe]
  );

  const getSnapshotForChat = useCallback(
    () => getSnapshot(chatId),
    [chatId, getSnapshot]
  );

  const data = useSyncExternalStore(subscribeToChat, getSnapshotForChat, getSnapshotForChat);

  return {
    chat: data?.chat ?? null,
    settings: data?.settings ?? {},
    setSettings: data?.setSettings ?? (() => {}),
    isReady: !!data?.chat,
  };
}
