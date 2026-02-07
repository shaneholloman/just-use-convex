import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "@just-use-convex/backend/convex/_generated/api";
import type { Id } from "@just-use-convex/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useAction } from "convex/react";
import { Bot } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOpenRouterModels, type OpenRouterModel } from "@/hooks/use-openrouter-models";
import { ChatInput } from "@/components/chat";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageList } from "@/components/chat/message-list";
import type { AskUserState, TodosState } from "@/components/chat/types";
import { useAgentInstance } from "@/providers/agent";
import { TodosDisplay } from "@/components/chat/todos-display";
import { useChat } from "@/hooks/use-chat";
import { AskUserDisplay } from "@/components/chat/ask-user-display";
import { ChatSandboxWorkspace } from "@/components/chat/chat-sandbox-workspace";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export const Route = createFileRoute("/(protected)/chats/$chatId")({
  component: ChatPage,
});

type SandboxWorkspaceSession = FunctionReturnType<typeof api.sandboxes.nodeFunctions.createChatSshAccess> &
  Pick<FunctionReturnType<typeof api.sandboxes.nodeFunctions.createChatPreviewAccess>, "preview">;

function ChatLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full">
      <Skeleton className="h-16 w-3/4 rounded-lg" />
      <Skeleton className="h-16 w-2/3 rounded-lg self-end" />
      <Skeleton className="h-16 w-3/4 rounded-lg" />
      <Skeleton className="h-16 w-1/2 rounded-lg self-end" />
    </div>
  );
}

function ChatPage() {
  const { chatId } = Route.useParams();
  const { chat, agent, settings, setSettings, isReady } = useAgentInstance(chatId);
  const { groupedModels, models } = useOpenRouterModels();
  const createChatSshAccess = useAction(api.sandboxes.nodeFunctions.createChatSshAccess);
  const createChatPreviewAccess = useAction(api.sandboxes.nodeFunctions.createChatPreviewAccess);

  const selectedModel = useMemo(
    () => models.find((m: OpenRouterModel) => m.slug === settings.model),
    [models, settings.model]
  );

  const [todosState, setTodosState] = useState<TodosState>({ todos: [] });
  const [askUserState, setAskUserState] = useState<AskUserState | null>(null);
  const [isSandboxPanelOpen, setIsSandboxPanelOpen] = useState(false);
  const [sandboxSession, setSandboxSession] = useState<SandboxWorkspaceSession | null>(null);

  const connectSandboxMutation = useMutation({
    mutationFn: async ({ chatId }: { chatId: Id<"chats"> }) => {
      const [sshSession, previewSession] = await Promise.all([
        createChatSshAccess({ chatId }),
        createChatPreviewAccess({ chatId }),
      ]);
      return {
        ...sshSession,
        preview: previewSession.preview,
      };
    },
    onSuccess: (nextSession) => {
      setSandboxSession(nextSession);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to connect sandbox");
    },
  });

  const connectSandbox = useCallback(async () => {
    await connectSandboxMutation.mutateAsync({
      chatId: chatId as Id<"chats">,
    });
  }, [chatId, connectSandboxMutation]);

  const handleSandboxToggle = useCallback(async () => {
    if (isSandboxPanelOpen) {
      setIsSandboxPanelOpen(false);
      return;
    }

    setIsSandboxPanelOpen(true);

    if (!sandboxSession || sandboxSession.chatId !== chatId) {
      await connectSandbox().catch(() => undefined);
    }
  }, [chatId, connectSandbox, isSandboxPanelOpen, sandboxSession]);

  const {
    status,
    error,
    stop,
    messages,
    isStreaming,
    handleSubmit,
    handleToolApprovalResponse,
    handleRegenerate,
    handleEditMessage,
  } = useChat(chat, agent);

  useEffect(() => {
    setIsSandboxPanelOpen(false);
    setSandboxSession(null);
  }, [chatId]);

  if (!isReady || !chat) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex">
          <ChatLoadingSkeleton />
        </div>
      </div>
    );
  }

  const chatContent = (
    <div className="flex flex-col h-full w-full">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-12 opacity-50" />}
              title="Start a conversation"
              description="Ask me anything or share files to get started"
            />
          ) : (
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              toolApprovalResponse={handleToolApprovalResponse}
              isCompact={isSandboxPanelOpen}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onTodosChange={setTodosState}
              onAskUserChange={setAskUserState}
            />
          )}
          {error && (
            <div className={isSandboxPanelOpen
              ? "text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3 w-full"
              : "text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3 mx-auto w-4xl"}
            >
              {error.message}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className={isSandboxPanelOpen ? "w-full px-3" : "mx-auto w-4xl"}>
        {askUserState?.state === "approval-requested" ? (
          <AskUserDisplay
            input={askUserState.input}
            approval={askUserState.approval}
            state={askUserState.state}
            toolApprovalResponse={handleToolApprovalResponse}
          />
        ) : (
          <TodosDisplay
            todos={todosState.todos}
            approval={todosState.todosApproval}
            state={todosState.todosState}
            toolApprovalResponse={handleToolApprovalResponse}
          />
        )}
      </div>
      <ChatInput
        onSubmit={handleSubmit}
        status={status}
        onStop={stop}
        settings={settings}
        setSettings={setSettings}
        groupedModels={groupedModels}
        models={models}
        selectedModel={selectedModel}
        hasMessages={messages.length > 0}
        isCompact={isSandboxPanelOpen}
        onSandboxToggle={() => void handleSandboxToggle()}
        isSandboxPanelOpen={isSandboxPanelOpen}
        isSandboxConnecting={connectSandboxMutation.isPending}
      />
    </div>
  );

  if (!isSandboxPanelOpen) {
    return chatContent;
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
      <ResizablePanel defaultSize={25} minSize={20}>
        {chatContent}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={75} minSize={25}>
        <ChatSandboxWorkspace
          session={sandboxSession}
          isLoading={connectSandboxMutation.isPending}
          onReconnect={connectSandbox}
          agent={agent}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
