import { ref, type Ref } from "vue";
import {
  conversationIdSchema,
  type ApiErrorResponse,
  type ConversationListResponse,
  type ConversationSummary,
} from "@ai-chat/shared";

export const ACTIVE_CONVERSATION_KEY = "ai-chat.active-conversation.v1";

interface UseConversationsResult {
  conversations: Ref<ConversationSummary[]>;
  activeConversationId: Ref<string | null>;
  loading: Ref<boolean>;
  errorMessage: Ref<string | null>;
  loadConversations: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  selectConversation: (conversationId: string) => boolean;
  setActiveConversation: (conversationId: string | null) => void;
  startNewConversation: () => void;
  ensureConversation: (conversationId: string) => void;
  renameConversation: (
    conversationId: string,
    title: string,
  ) => Promise<ConversationSummary>;
  deleteConversation: (conversationId: string) => Promise<string | null>;
  requestAutomaticTitle: (
    conversationId: string,
    turnId: string,
  ) => Promise<void>;
  dismissError: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return body.error?.message || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

function readStoredConversationId(): string | null {
  try {
    const value = window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    return conversationIdSchema.safeParse(value).success ? value : null;
  } catch {
    return null;
  }
}

function persistConversationId(conversationId: string | null): void {
  try {
    if (conversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
  } catch {
    // A blocked storage API must not prevent using the in-memory selection.
  }
}

function replaceSummary(
  summaries: ConversationSummary[],
  summary: ConversationSummary,
): ConversationSummary[] {
  const index = summaries.findIndex((item) => item.id === summary.id);
  if (index < 0) {
    return [summary, ...summaries];
  }
  const next = summaries.slice();
  next[index] = summary;
  return next;
}

export function useConversations(): UseConversationsResult {
  const conversations = ref<ConversationSummary[]>([]);
  const activeConversationId = ref<string | null>(null);
  const loading = ref(true);
  const errorMessage = ref<string | null>(null);
  const automaticTitleRequests = new Set<string>();
  let requestVersion = 0;

  async function fetchList(): Promise<ConversationSummary[]> {
    const response = await fetch("/api/conversations", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    const payload = (await response.json()) as ConversationListResponse;
    return Array.isArray(payload.conversations) ? payload.conversations : [];
  }

  function chooseInitialConversation(): void {
    const stored = readStoredConversationId();
    const selected = conversations.value.some((item) => item.id === stored)
      ? stored
      : conversations.value[0]?.id ?? null;
    activeConversationId.value = selected;
    persistConversationId(selected);
  }

  async function loadConversations(): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    try {
      conversations.value = await fetchList();
      if (version !== requestVersion) {
        return;
      }
      chooseInitialConversation();
      errorMessage.value = null;
    } catch (error) {
      if (version === requestVersion) {
        errorMessage.value =
          error instanceof Error ? error.message : "无法加载会话列表";
      }
    } finally {
      if (version === requestVersion) {
        loading.value = false;
      }
    }
  }

  async function refreshConversations(): Promise<void> {
    const version = ++requestVersion;
    try {
      const next = await fetchList();
      if (version !== requestVersion) {
        return;
      }
      conversations.value = next;
      if (
        activeConversationId.value &&
        !next.some((item) => item.id === activeConversationId.value)
      ) {
        activeConversationId.value = next[0]?.id ?? null;
        persistConversationId(activeConversationId.value);
      }
      errorMessage.value = null;
    } catch (error) {
      if (version === requestVersion) {
        errorMessage.value =
          error instanceof Error ? error.message : "无法刷新会话列表";
      }
    }
  }

  function setActiveConversation(conversationId: string | null): void {
    activeConversationId.value = conversationId;
    persistConversationId(conversationId);
  }

  function selectConversation(conversationId: string): boolean {
    if (!conversations.value.some((item) => item.id === conversationId)) {
      return false;
    }
    setActiveConversation(conversationId);
    return true;
  }

  function startNewConversation(): void {
    setActiveConversation(null);
  }

  function ensureConversation(conversationId: string): void {
    if (conversations.value.some((item) => item.id === conversationId)) {
      setActiveConversation(conversationId);
      return;
    }
    const now = nowIso();
    conversations.value = replaceSummary(conversations.value, {
      id: conversationId,
      title: "新对话",
      titleSource: "auto",
      createdAt: now,
      updatedAt: now,
    });
    setActiveConversation(conversationId);
  }

  async function renameConversation(
    conversationId: string,
    title: string,
  ): Promise<ConversationSummary> {
    const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
    const summary = (await response.json()) as ConversationSummary;
    conversations.value = replaceSummary(conversations.value, summary);
    return summary;
  }

  async function deleteConversation(conversationId: string): Promise<string | null> {
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    conversations.value = conversations.value.filter(
      (item) => item.id !== conversationId,
    );
    if (activeConversationId.value === conversationId) {
      const next = conversations.value[0]?.id ?? null;
      setActiveConversation(next);
      return next;
    }
    return activeConversationId.value;
  }

  async function requestAutomaticTitle(
    conversationId: string,
    turnId: string,
  ): Promise<void> {
    const requestKey = `${conversationId}:${turnId}`;
    if (automaticTitleRequests.has(requestKey)) {
      return;
    }
    automaticTitleRequests.add(requestKey);
    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/auto-title`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ turnId }),
        },
      );
      if (!response.ok) {
        return;
      }
      const summary = (await response.json()) as ConversationSummary;
      conversations.value = replaceSummary(conversations.value, summary);
    } finally {
      automaticTitleRequests.delete(requestKey);
    }
  }

  function dismissError(): void {
    errorMessage.value = null;
  }

  return {
    conversations,
    activeConversationId,
    loading,
    errorMessage,
    loadConversations,
    refreshConversations,
    selectConversation,
    setActiveConversation,
    startNewConversation,
    ensureConversation,
    renameConversation,
    deleteConversation,
    requestAutomaticTitle,
    dismissError,
  };
}
