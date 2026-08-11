import type { RenderedChatMessage, StreamState } from "../composables/use_chat";

export const QUERY_NAVIGATOR_VISIBLE_COUNT = 5;
export const QUERY_NAVIGATOR_WHEEL_THRESHOLD = 40;
export const QUERY_NAVIGATOR_BUFFER_COUNT = 1;

export interface CenteredQueryWindow {
  centerIndex: number | null;
  visibleStart: number;
  visibleEnd: number;
  bufferedStart: number;
  bufferedEnd: number;
  indices: number[];
}

export interface QueryNavigationItem {
  key: string;
  turnId: string;
  messageIndex: number;
  userMessage: RenderedChatMessage;
  assistantMessage: RenderedChatMessage | null;
}

export function createQueryNavigationItems(
  messages: RenderedChatMessage[],
): QueryNavigationItem[] {
  const assistantByTurn = new Map<string, RenderedChatMessage>();
  const userItems: Array<Omit<QueryNavigationItem, "assistantMessage">> = [];

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === "assistant") {
      assistantByTurn.set(message.turnId, message);
      continue;
    }

    if (message.role === "user") {
      userItems.push({
        key: message.renderKey,
        turnId: message.turnId,
        messageIndex,
        userMessage: message,
      });
    }
  }

  return userItems.map((item) => ({
    ...item,
    assistantMessage: assistantByTurn.get(item.turnId) ?? null,
  }));
}

export function normalizePreviewText(content: string): string {
  return content
    .replace(/```[^\n]*\n?([\s\S]*?)```/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] |> ?)/gmu, "")
    .replace(/(?:\*\*|__|~~|\*|_)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function queryPreview(item: QueryNavigationItem): string {
  return normalizePreviewText(item.userMessage.content) || "未命名问题";
}

export function answerPreview(
  item: QueryNavigationItem,
  streamState: StreamState,
): string {
  const assistant = item.assistantMessage;
  const content = assistant ? normalizePreviewText(assistant.content) : "";

  if (content) {
    return content;
  }
  if (assistant?.status === "stopped") {
    return "回答已停止";
  }
  if (assistant?.status === "error") {
    return "回答生成失败";
  }
  if (assistant?.status === "streaming" || streamState !== "idle") {
    return "正在生成回答…";
  }
  return "暂无回答";
}

export function clampQueryWindowStart(
  requestedStart: number,
  itemCount: number,
  visibleCount = QUERY_NAVIGATOR_VISIBLE_COUNT,
): number {
  const maximumStart = Math.max(0, itemCount - visibleCount);
  return Math.min(Math.max(0, Math.trunc(requestedStart)), maximumStart);
}

export function ensureActiveQueryVisible(
  activeIndex: number | null,
  currentStart: number,
  itemCount: number,
  visibleCount = QUERY_NAVIGATOR_VISIBLE_COUNT,
): number {
  const start = clampQueryWindowStart(currentStart, itemCount, visibleCount);
  if (activeIndex === null || activeIndex < 0 || activeIndex >= itemCount) {
    return start;
  }
  if (activeIndex < start) {
    return activeIndex;
  }
  if (activeIndex >= start + visibleCount) {
    return clampQueryWindowStart(
      activeIndex - visibleCount + 1,
      itemCount,
      visibleCount,
    );
  }
  return start;
}

/**
 * Builds the logical five-slot viewport around the selected Query. The start
 * and end values intentionally remain unclamped so callers can preserve the
 * center slot at the beginning and end of a conversation without rendering
 * fake bars for missing items.
 */
export function createCenteredQueryWindow(
  requestedCenterIndex: number | null,
  itemCount: number,
  visibleCount = QUERY_NAVIGATOR_VISIBLE_COUNT,
  bufferCount = QUERY_NAVIGATOR_BUFFER_COUNT,
): CenteredQueryWindow {
  if (itemCount <= 0 || visibleCount <= 0) {
    return {
      centerIndex: null,
      visibleStart: 0,
      visibleEnd: -1,
      bufferedStart: 0,
      bufferedEnd: -1,
      indices: [],
    };
  }

  const centerIndex = Math.min(
    Math.max(0, Math.trunc(requestedCenterIndex ?? 0)),
    itemCount - 1,
  );
  const centerSlot = Math.floor(visibleCount / 2);
  const visibleStart = centerIndex - centerSlot;
  const visibleEnd = visibleStart + visibleCount - 1;
  const bufferedStart = visibleStart - Math.max(0, bufferCount);
  const bufferedEnd = visibleEnd + Math.max(0, bufferCount);
  const indices: number[] = [];

  for (
    let index = Math.max(0, bufferedStart);
    index <= Math.min(itemCount - 1, bufferedEnd);
    index += 1
  ) {
    indices.push(index);
  }

  return {
    centerIndex,
    visibleStart,
    visibleEnd,
    bufferedStart,
    bufferedEnd,
    indices,
  };
}

export function isQueryIndexInCenteredWindow(
  index: number,
  window: Pick<CenteredQueryWindow, "visibleStart" | "visibleEnd">,
): boolean {
  return index >= window.visibleStart && index <= window.visibleEnd;
}

export function activeQueryIndexForMessage(
  items: QueryNavigationItem[],
  visibleMessageIndex: number | null,
): number | null {
  if (items.length === 0) {
    return null;
  }
  if (visibleMessageIndex === null) {
    return 0;
  }

  let activeIndex = 0;
  for (const [index, item] of items.entries()) {
    if (item.messageIndex > visibleMessageIndex) {
      break;
    }
    activeIndex = index;
  }
  return activeIndex;
}
