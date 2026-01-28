"use client";

import { memo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import type { ChatAddToolApproveResponseFunction } from "ai";
import {
  Message,
  MessageContent,
  MessageActions,
} from "@/components/ai-elements/message";
import { TextPart } from "./text-part";
import { FilePart } from "./file-part";
import { CopyButton } from "./copy-button";
import { ChainOfThoughtPart, isChainOfThoughtPart } from "./chain-of-thought-part";
import { getToolName } from "./tool-part";

export interface MessageItemProps {
  message: UIMessage;
  isStreaming: boolean;
  toolApprovalResponse: ChatAddToolApproveResponseFunction;
}

const EXCLUDED_TOOLS = ["write_todos"];

function isExcludedTool(part: UIMessage["parts"][number]): boolean {
  return EXCLUDED_TOOLS.includes(getToolName(part.type));
}

export const MessageItem = memo(function MessageItem({
  message,
  isStreaming,
  toolApprovalResponse,
}: MessageItemProps) {
  const messageText = message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as Extract<UIMessage["parts"][number], { type: "text" }>).text)
    .join("\n");

  const renderParts = () => {
    const elements: React.ReactNode[] = [];
    let chainGroup: { part: UIMessage["parts"][number]; index: number }[] = [];

    message.parts.forEach((part, i) => {
      if (part.type === "step-start" || isExcludedTool(part)) {
        return;
      }
      if (isChainOfThoughtPart(part)) {
        chainGroup.push({ part, index: i });
      } else {
        if (chainGroup.length > 0) {
          elements.push(
            <ChainOfThoughtPart
              key={`chain-${chainGroup[0].index}`}
              isStreaming={isStreaming}
              chainGroup={chainGroup}
              toolApprovalResponse={toolApprovalResponse}
            />
          );
          chainGroup = [];
        }

        if (part.type === "text") {
          elements.push(
            <TextPart key={i} part={part} role={message.role} partKey={i} />
          );
        } else if (part.type === "file") {
          elements.push(<FilePart key={i} part={part} partKey={i} />);
        }
      }
    });

    if (chainGroup.length > 0) {
      elements.push(
        <ChainOfThoughtPart
          key={`chain-${chainGroup[0].index}`}
          isStreaming={isStreaming}
          chainGroup={chainGroup}
          toolApprovalResponse={toolApprovalResponse}
        />
      );
    }

    return elements;
  };

  return (
    <Message from={message.role} className="mx-auto w-4xl px-4">
      <div className="group/message">
        <MessageContent className="group-[.is-user]:max-w-[70%]">
          {renderParts()}
        </MessageContent>
        {messageText && !isStreaming && (
          <MessageActions className="mt-2 opacity-0 transition-opacity group-hover/message:opacity-100 justify-end">
            <CopyButton text={messageText} />
          </MessageActions>
        )}
      </div>
    </Message>
  );
});
