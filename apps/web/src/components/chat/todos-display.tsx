import { ListTodoIcon } from "lucide-react";
import {
  Queue,
  QueueSection,
  QueueSectionTrigger,
  QueueSectionLabel,
  QueueSectionContent,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
  type QueueTodo,
} from "@/components/ai-elements/queue";
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
  type ConfirmationProps,
} from "@/components/ai-elements/confirmation";
import { memo } from "react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export interface TodosDisplayProps {
  todos: QueueTodo[];
  approval?: ConfirmationProps['approval'];
  state?: ConfirmationProps['state'];
  toolApprovalResponse: ChatAddToolApproveResponseFunction;
}

export const TodosDisplay = memo(function TodosDisplay({ todos, approval, state, toolApprovalResponse }: TodosDisplayProps) {
  if (todos.length === 0) return null;

  const activeCount = todos.filter((t) => t.status !== "done").length;

  const [rejectReason, setRejectReason] = useState<string | undefined>(undefined);

  return (
    <Queue className="mb-2">
      <QueueSection defaultOpen>
        <QueueSectionTrigger>
          <QueueSectionLabel
            icon={<ListTodoIcon className="size-4" />}
            label={activeCount === 1 ? "task" : "tasks"}
            count={activeCount}
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList>
            {todos.map((todo, i) => (
              <QueueItem key={todo.id || i}>
                <div className="flex items-start gap-2">
                  <QueueItemIndicator
                    completed={todo.status === "done"}
                    className={
                      todo.status === "in_progress"
                        ? "animate-pulse bg-blue-500"
                        : ""
                    }
                  />
                  <QueueItemContent completed={todo.status === "done"}>
                    {todo.title}
                  </QueueItemContent>
                </div>
              </QueueItem>
            ))}
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
      {state && (
        <Confirmation approval={approval} state={state} className="flex flex-row items-center">
          <ConfirmationRequest>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection"
            />
            <ConfirmationActions>
              <ConfirmationAction variant="outline" onClick={() => toolApprovalResponse({ id: approval?.id ?? '', approved: false, reason: rejectReason })}>
                Reject
              </ConfirmationAction>
              <ConfirmationAction onClick={() => toolApprovalResponse({ id: approval?.id ?? '', approved: true, reason: undefined })}>
                Approve
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <ConfirmationTitle>Tasks approved.</ConfirmationTitle>
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <ConfirmationTitle>Tasks rejected{approval?.reason ? `: ${approval.reason}` : '.'}</ConfirmationTitle>
          </ConfirmationRejected>
        </Confirmation>
      )}
    </Queue>
  );
});
