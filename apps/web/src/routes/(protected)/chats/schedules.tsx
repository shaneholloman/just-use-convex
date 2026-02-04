import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useChatsList } from "@/hooks/use-chats";
import { SchedulePanel } from "@/components/chat/schedule-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";
import { useAgentInstance } from "@/providers/agent";

export const Route = createFileRoute("/(protected)/chats/schedules")({
  component: SchedulesPage,
});

function SchedulesPage() {
  const navigate = useNavigate();
  const pinnedChatsQuery = useChatsList({ isPinned: true });
  const unpinnedChatsQuery = useChatsList({ isPinned: false });

  const activeChat = useMemo(() => {
    const pinned = pinnedChatsQuery.results ?? [];
    if (pinned.length > 0) return pinned[0];
    const unpinned = unpinnedChatsQuery.results ?? [];
    if (unpinned.length > 0) return unpinned[0];
    return null;
  }, [pinnedChatsQuery.results, unpinnedChatsQuery.results]);

  if (pinnedChatsQuery.isLoading && unpinnedChatsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto w-full">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-[360px] w-full rounded-lg" />
      </div>
    );
  }

  if (!activeChat) {
    return (
      <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto w-full">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia>
              <CalendarClock className="size-12 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>No chats yet</EmptyTitle>
            <EmptyDescription>
              Create a chat first to attach schedules.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => navigate({ to: "/chats" })}>
            Go to chats
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <SchedulesForChat
      chatId={activeChat._id}
      chatTitle={activeChat.title}
    />
  );
}

function SchedulesForChat({ chatId, chatTitle }: { chatId: string; chatTitle: string }) {
  const { agent, isReady } = useAgentInstance(chatId);

  if (!isReady) {
    return (
      <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto w-full">
        <Skeleton className="h-[360px] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto w-full">
      <SchedulePanel agent={agent} chatTitle={chatTitle} chatId={chatId} />
    </div>
  );
}
