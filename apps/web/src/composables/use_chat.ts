import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  type Ref,
} from "vue";
import {
  DEFAULT_REASONING_LEVEL,
  reasoningLevelSchema,
  type ApiErrorResponse,
  type ChatMessage,
  type ChatResponse,
  type HealthResponse,
  type ReasoningLevel,
  type StreamDeltaData,
  type StreamDoneData,
  type StreamErrorData,
  type StreamMetaData,
  type StreamPhaseData,
  type StreamReasoningDeltaData,
} from "@ai-chat/shared";
import { SseEventParser, type ParsedSseEvent } from "../lib/sse";
import { TypewriterBuffer } from "../lib/typewriter";

export type StreamState =
  | "idle"
  | "connecting"
  | "reasoning"
  | "streaming"
  | "draining";

/**
 * A message with an identity that is stable for the lifetime of this page.
 *
 * `id` is allowed to change when an optimistic message receives the server
 * response. Virtualized rows must not use that mutable value as their key.
 */
export interface RenderedChatMessage extends ChatMessage {
  renderKey: string;
}

const REASONING_PREFERENCE_KEY = "ai-chat.reasoning-level.v1";

interface UseChatResult {
  messages: Ref<RenderedChatMessage[]>;
  conversationId: Ref<string | null>;
  loading: Ref<boolean>;
  streamState: Ref<StreamState>;
  isGenerating: Readonly<Ref<boolean>>;
  errorMessage: Ref<string | null>;
  model: Ref<string>;
  reasoningLevels: Ref<ReasoningLevel[]>;
  reasoningLevel: Ref<ReasoningLevel>;
  loadChat: (conversationId?: string | null) => Promise<void>;
  clearChat: () => void;
  sendMessage: (
    content: string,
    reasoningLevel?: ReasoningLevel,
  ) => Promise<void>;
  setReasoningLevel: (level: ReasoningLevel) => void;
  stopGeneration: () => void;
  dismissError: () => void;
}

export interface UseChatOptions {
  onConversationCreated?: (conversationId: string) => void;
  onTurnCompleted?: (conversationId: string, turnId: string) => void | Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function optimisticMessage(
  role: "user" | "assistant",
  content: string,
  position: number,
  turnId: string,
  conversationId: string | null,
  reasoningLevel: ReasoningLevel,
): RenderedChatMessage {
  const now = nowIso();
  return {
    renderKey: `render-${crypto.randomUUID()}`,
    id: `local-${crypto.randomUUID()}`,
    conversationId: conversationId ?? "",
    turnId,
    position,
    role,
    content,
    reasoningContent: null,
    reasoningDurationMs: null,
    status: role === "assistant" ? "streaming" : "completed",
    model: role === "assistant" ? "deepseek-v4-flash" : null,
    reasoningLevel: role === "assistant" ? reasoningLevel : null,
    finishReason: null,
    usage: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function withRenderKey(message: ChatMessage): RenderedChatMessage {
  return {
    ...message,
    renderKey: `render-${crypto.randomUUID()}`,
  };
}

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return reasoningLevelSchema.safeParse(value).success;
}

function readReasoningPreference(
  supportedLevels: ReasoningLevel[],
): ReasoningLevel {
  const fallback = supportedLevels.includes(DEFAULT_REASONING_LEVEL)
    ? DEFAULT_REASONING_LEVEL
    : supportedLevels[0] ?? DEFAULT_REASONING_LEVEL;
  try {
    const stored = window.localStorage.getItem(REASONING_PREFERENCE_KEY);
    return isReasoningLevel(stored) && supportedLevels.includes(stored)
      ? stored
      : fallback;
  } catch {
    return fallback;
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return body.error?.message || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function normalizeEmptyReasoning(message: ChatMessage): void {
  if (message.reasoningContent === "") {
    message.reasoningContent = null;
  }
}

function notifyTurnCompleted(
  callback: UseChatOptions["onTurnCompleted"],
  conversationId: string,
  turnId: string,
): void {
  try {
    const result = callback?.(conversationId, turnId);
    if (result) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Title refresh is intentionally best effort and must not affect chat.
  }
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const messages = ref<RenderedChatMessage[]>([]);
  const conversationId = ref<string | null>(null);
  const loading = ref(true);
  const streamState = ref<StreamState>("idle");
  const errorMessage = ref<string | null>(null);
  const model = ref("deepseek-v4-flash");
  const reasoningLevels = ref<ReasoningLevel[]>([DEFAULT_REASONING_LEVEL]);
  const reasoningLevel = ref<ReasoningLevel>(DEFAULT_REASONING_LEVEL);
  const isGenerating = computed(() => streamState.value !== "idle");
  let activeController: AbortController | null = null;
  let activeWriter: TypewriterBuffer | null = null;
  let activeAssistant: RenderedChatMessage | null = null;
  let loadVersion = 0;

  async function loadChat(
    targetConversationId: string | null = null,
  ): Promise<void> {
    const version = ++loadVersion;
    loading.value = true;
    messages.value = [];
    conversationId.value = targetConversationId;
    try {
      const chatResponsePromise = targetConversationId
        ? fetch(
            `/api/conversations/${encodeURIComponent(targetConversationId)}`,
            { headers: { Accept: "application/json" } },
          )
        : null;
      const [chatResponse, healthResponse] = await Promise.all([
        chatResponsePromise,
        fetch("/api/health", {
          headers: { Accept: "application/json" },
        }),
      ]);
      if (version !== loadVersion) {
        return;
      }
      if (chatResponse && !chatResponse.ok) {
        throw new Error(await readApiError(chatResponse));
      }
      if (!healthResponse.ok) {
        throw new Error(await readApiError(healthResponse));
      }
      const health = (await healthResponse.json()) as HealthResponse;
      const chat = chatResponse
        ? ((await chatResponse.json()) as ChatResponse)
        : null;
      if (version !== loadVersion) {
        return;
      }
      const supportedLevels = (
        health.reasoningCapabilities?.levels ?? [DEFAULT_REASONING_LEVEL]
      ).filter(isReasoningLevel);
      messages.value = (chat?.messages ?? []).map(withRenderKey);
      conversationId.value = chat?.conversation.id ?? targetConversationId;
      model.value = health.model;
      reasoningLevels.value =
        supportedLevels.length > 0
          ? supportedLevels
          : [DEFAULT_REASONING_LEVEL];
      reasoningLevel.value = readReasoningPreference(reasoningLevels.value);
      errorMessage.value = null;
    } catch (error) {
      if (version === loadVersion) {
        errorMessage.value =
          error instanceof Error ? error.message : "无法加载本地对话";
      }
    } finally {
      if (version === loadVersion) {
        loading.value = false;
      }
    }
  }

  function clearChat(): void {
    loadVersion += 1;
    conversationId.value = null;
    messages.value = [];
    loading.value = false;
    errorMessage.value = null;
    streamState.value = "idle";
  }

  function applyMeta(
    data: StreamMetaData,
    user: RenderedChatMessage,
    assistant: RenderedChatMessage,
  ): void {
    if (typeof data.conversationId === "string" && data.conversationId) {
      const wasEmpty = conversationId.value === null;
      conversationId.value = data.conversationId;
      if (wasEmpty) {
        options.onConversationCreated?.(data.conversationId);
      }
      user.conversationId = data.conversationId;
      assistant.conversationId = data.conversationId;
    }
    user.id = data.userMessageId;
    user.turnId = data.turnId;
    assistant.id = data.assistantMessageId;
    assistant.turnId = data.turnId;
    assistant.model = data.model;
    assistant.reasoningLevel = data.reasoningLevel;
  }

  async function handleEvent(
    parsedEvent: ParsedSseEvent,
    user: RenderedChatMessage,
    assistant: RenderedChatMessage,
    writer: TypewriterBuffer,
  ): Promise<"continue" | "terminal"> {
    let data: unknown;
    try {
      data = JSON.parse(parsedEvent.data);
    } catch {
      throw new Error("服务器返回了无法解析的流数据");
    }

    if (parsedEvent.event === "meta") {
      applyMeta(data as StreamMetaData, user, assistant);
      return "continue";
    }
    if (parsedEvent.event === "phase") {
      const phase = data as StreamPhaseData;
      if (phase.assistantMessageId === assistant.id) {
        if (phase.phase === "reasoning") {
          assistant.reasoningContent ??= "";
        } else {
          normalizeEmptyReasoning(assistant);
          if (typeof phase.reasoningDurationMs === "number") {
            assistant.reasoningDurationMs = phase.reasoningDurationMs;
          }
        }
        streamState.value =
          phase.phase === "reasoning" ? "reasoning" : "streaming";
      }
      return "continue";
    }
    if (parsedEvent.event === "reasoning_delta") {
      const delta = data as StreamReasoningDeltaData;
      if (delta.assistantMessageId === assistant.id) {
        assistant.reasoningContent =
          (assistant.reasoningContent ?? "") + delta.text;
        assistant.updatedAt = nowIso();
      }
      return "continue";
    }
    if (parsedEvent.event === "delta") {
      const delta = data as StreamDeltaData;
      if (delta.assistantMessageId === assistant.id) {
        writer.push(delta.text);
      }
      return "continue";
    }
    if (parsedEvent.event === "done") {
      const done = data as StreamDoneData;
      streamState.value = "draining";
      await writer.finish(300);
      assistant.status = "completed";
      normalizeEmptyReasoning(assistant);
      assistant.finishReason = done.finishReason;
      assistant.usage = done.usage;
      if (typeof done.reasoningDurationMs === "number") {
        assistant.reasoningDurationMs = done.reasoningDurationMs;
      }
      assistant.updatedAt = nowIso();
      const activeConversationId = conversationId.value;
      if (activeConversationId) {
        notifyTurnCompleted(options.onTurnCompleted, activeConversationId, user.turnId);
      }
      return "terminal";
    }
    if (parsedEvent.event === "error") {
      const streamError = data as StreamErrorData;
      streamState.value = "draining";
      await writer.finish(300);
      assistant.status = "error";
      normalizeEmptyReasoning(assistant);
      assistant.errorCode = streamError.code;
      if (typeof streamError.reasoningDurationMs === "number") {
        assistant.reasoningDurationMs = streamError.reasoningDurationMs;
      }
      assistant.updatedAt = nowIso();
      errorMessage.value = streamError.message;
      const activeConversationId = conversationId.value;
      if (activeConversationId) {
        notifyTurnCompleted(options.onTurnCompleted, activeConversationId, user.turnId);
      }
      return "terminal";
    }
    return "continue";
  }

  async function sendMessage(
    rawContent: string,
    requestedReasoningLevel = reasoningLevel.value,
  ): Promise<void> {
    const content = rawContent.trim();
    if (!content || isGenerating.value) {
      return;
    }
    if (!reasoningLevels.value.includes(requestedReasoningLevel)) {
      errorMessage.value = "当前模型不支持所选推理强度";
      return;
    }

    errorMessage.value = null;
    streamState.value = "connecting";
    const highestPosition = messages.value.at(-1)?.position ?? -1;
    const localTurnId = `local-${crypto.randomUUID()}`;
    const user = reactive(
      optimisticMessage(
        "user",
        content,
        highestPosition + 1,
        localTurnId,
        conversationId.value,
        requestedReasoningLevel,
      ),
    );
    const assistant = reactive(
      optimisticMessage(
        "assistant",
        "",
        highestPosition + 2,
        localTurnId,
        conversationId.value,
        requestedReasoningLevel,
      ),
    );
    messages.value.push(user, assistant);

    const controller = new AbortController();
    const writer = new TypewriterBuffer((text) => {
      assistant.content += text;
      assistant.updatedAt = nowIso();
    });
    activeController = controller;
    activeWriter = writer;
    activeAssistant = assistant;
    let receivedMeta = false;
    let terminalEventReceived = false;

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: conversationId.value,
          content,
          reasoningLevel: requestedReasoningLevel,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      if (!response.body) {
        throw new Error("浏览器未收到流式响应");
      }

      streamState.value = "streaming";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseEventParser();

      try {
        while (true) {
          const { done, value } = await reader.read();
          const parsedEvents = done
            ? [...parser.feed(decoder.decode()), ...parser.end()]
            : parser.feed(decoder.decode(value, { stream: true }));

          for (const event of parsedEvents) {
            if (event.event === "meta") {
              receivedMeta = true;
            }
            const result = await handleEvent(event, user, assistant, writer);
            if (result === "terminal") {
              terminalEventReceived = true;
            }
          }
          if (done) {
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!terminalEventReceived && !controller.signal.aborted) {
        await writer.finish(300);
        assistant.status = "error";
        assistant.errorCode = "UPSTREAM_STREAM_INTERRUPTED";
        errorMessage.value = "流式响应意外结束";
        if (conversationId.value) {
          notifyTurnCompleted(options.onTurnCompleted, conversationId.value, user.turnId);
        }
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        writer.flush();
        assistant.status = "stopped";
        normalizeEmptyReasoning(assistant);
        assistant.updatedAt = nowIso();
        if (conversationId.value && assistant.content.length > 0) {
          notifyTurnCompleted(options.onTurnCompleted, conversationId.value, user.turnId);
        }
      } else {
        writer.flush();
        if (!receivedMeta) {
          messages.value = messages.value.filter(
            (message) => message !== user && message !== assistant,
          );
        } else {
          assistant.status = "error";
          normalizeEmptyReasoning(assistant);
          assistant.errorCode = "UPSTREAM_STREAM_INTERRUPTED";
          if (conversationId.value) {
            notifyTurnCompleted(options.onTurnCompleted, conversationId.value, user.turnId);
          }
        }
        errorMessage.value =
          error instanceof Error ? error.message : "发送消息失败";
      }
    } finally {
      if (activeController === controller) {
        activeController = null;
        activeWriter = null;
        activeAssistant = null;
        streamState.value = "idle";
      }
    }
  }

  function setReasoningLevel(level: ReasoningLevel): void {
    if (isGenerating.value || !reasoningLevels.value.includes(level)) {
      return;
    }
    reasoningLevel.value = level;
    try {
      window.localStorage.setItem(REASONING_PREFERENCE_KEY, level);
    } catch {
      // A blocked storage API must not prevent changing the in-memory setting.
    }
  }

  function stopGeneration(): void {
    if (!activeController) {
      return;
    }
    activeController.abort();
    activeWriter?.flush();
    if (activeAssistant) {
      activeAssistant.status = "stopped";
      normalizeEmptyReasoning(activeAssistant);
      activeAssistant.updatedAt = nowIso();
    }
  }

  function dismissError(): void {
    errorMessage.value = null;
  }

  onBeforeUnmount(() => {
    activeController?.abort();
    activeWriter?.dispose();
  });

  return {
    messages,
    conversationId,
    loading,
    streamState,
    isGenerating,
    errorMessage,
    model,
    reasoningLevels,
    reasoningLevel,
    loadChat,
    clearChat,
    sendMessage,
    setReasoningLevel,
    stopGeneration,
    dismissError,
  };
}
