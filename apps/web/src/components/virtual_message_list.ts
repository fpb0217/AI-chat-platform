import type { ChatMessage } from "@ai-chat/shared";

export const MESSAGE_LIST_OVERSCAN = 6;
export const MESSAGE_LIST_GAP = 30;
export const BOTTOM_THRESHOLD = 96;

export function estimateMessageSize(
  message: Pick<
    ChatMessage,
    "role" | "content" | "reasoningContent" | "status"
  > | undefined,
): number {
  if (!message) {
    return 96;
  }

  const answerLines = Math.max(1, Math.ceil(message.content.length / 78));
  const reasoningLines = message.reasoningContent
    ? Math.max(2, Math.ceil(message.reasoningContent.length / 92))
    : 0;
  const base = message.role === "user" ? 70 : 88;
  const statusAllowance = message.status === "completed" ? 0 : 24;

  return Math.max(
    72,
    base +
      Math.min(answerLines, 16) * 22 +
      Math.min(reasoningLines, 12) * 20 +
      statusAllowance,
  );
}
