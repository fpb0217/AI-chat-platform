import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  type Ref,
} from "vue";
import type {
  ApiErrorResponse,
  ChatMessage,
  ChatResponse,
  StreamDeltaData,
  StreamDoneData,
  StreamErrorData,
  StreamMetaData,
} from "@ai-chat/shared";
import { SseEventParser, type ParsedSseEvent } from "../lib/sse";
import { TypewriterBuffer } from "../lib/typewriter";

export type StreamState =
  | "idle"
  | "connecting"
  | "streaming"
  | "draining";

interface UseChatResult {
  messages: Ref<ChatMessage[]>;
  loading: Ref<boolean>;
  streamState: Ref<StreamState>;
  isGenerating: Readonly<Ref<boolean>>;
  errorMessage: Ref<string | null>;
  loadChat: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  dismissError: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function optimisticMessage(
  role: "user" | "assistant",
  content: string,
  position: number,
  turnId: string,
): ChatMessage {
  const now = nowIso();
  return {
    id: `local-${crypto.randomUUID()}`,
    conversationId: "default",
    turnId,
    position,
    role,
    content,
    status: role === "assistant" ? "streaming" : "completed",
    model: role === "assistant" ? "deepseek-v4-flash" : null,
    finishReason: null,
    usage: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
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

export function useChat(): UseChatResult {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(true);
  const streamState = ref<StreamState>("idle");
  const errorMessage = ref<string | null>(null);
  const isGenerating = computed(() => streamState.value !== "idle");
  let activeController: AbortController | null = null;
  let activeWriter: TypewriterBuffer | null = null;
  let activeAssistant: ChatMessage | null = null;

  async function loadChat(): Promise<void> {
    loading.value = true;
    try {
      const response = await fetch("/api/chat", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const chat = (await response.json()) as ChatResponse;
      messages.value = chat.messages;
      errorMessage.value = null;
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "无法加载本地对话";
    } finally {
      loading.value = false;
    }
  }

  function applyMeta(
    data: StreamMetaData,
    user: ChatMessage,
    assistant: ChatMessage,
  ): void {
    user.id = data.userMessageId;
    user.turnId = data.turnId;
    assistant.id = data.assistantMessageId;
    assistant.turnId = data.turnId;
  }

  async function handleEvent(
    parsedEvent: ParsedSseEvent,
    user: ChatMessage,
    assistant: ChatMessage,
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
      assistant.finishReason = done.finishReason;
      assistant.usage = done.usage;
      assistant.updatedAt = nowIso();
      return "terminal";
    }
    if (parsedEvent.event === "error") {
      const streamError = data as StreamErrorData;
      streamState.value = "draining";
      await writer.finish(300);
      assistant.status = "error";
      assistant.errorCode = streamError.code;
      assistant.updatedAt = nowIso();
      errorMessage.value = streamError.message;
      return "terminal";
    }
    return "continue";
  }

  async function sendMessage(rawContent: string): Promise<void> {
    const content = rawContent.trim();
    if (!content || isGenerating.value) {
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
      ),
    );
    const assistant = reactive(
      optimisticMessage(
        "assistant",
        "",
        highestPosition + 2,
        localTurnId,
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
        body: JSON.stringify({ content }),
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
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        writer.flush();
        assistant.status = "stopped";
        assistant.updatedAt = nowIso();
      } else {
        writer.flush();
        if (!receivedMeta) {
          messages.value = messages.value.filter(
            (message) => message !== user && message !== assistant,
          );
        } else {
          assistant.status = "error";
          assistant.errorCode = "UPSTREAM_STREAM_INTERRUPTED";
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

  function stopGeneration(): void {
    if (!activeController) {
      return;
    }
    activeController.abort();
    activeWriter?.flush();
    if (activeAssistant) {
      activeAssistant.status = "stopped";
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
    loading,
    streamState,
    isGenerating,
    errorMessage,
    loadChat,
    sendMessage,
    stopGeneration,
    dismissError,
  };
}
