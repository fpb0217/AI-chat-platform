<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  ref,
  watch,
} from "vue";
import { AlertCircle, ArrowDown, Menu, Plus, X } from "lucide-vue-next";
import type { ConversationSummary } from "@ai-chat/shared";
import ChatComposer from "./components/ChatComposer.vue";
import ConversationSidebar from "./components/ConversationSidebar.vue";
import EmptyState from "./components/EmptyState.vue";
import ReasoningSelector from "./components/ReasoningSelector.vue";
import RenameConversationModal from "./components/RenameConversationModal.vue";
import ThemeToggle from "./components/ThemeToggle.vue";
import VirtualMessageList from "./components/VirtualMessageList.vue";
import { useChat } from "./composables/use_chat";
import { useConversations } from "./composables/use_conversations";
import { useTheme } from "./composables/use_theme";

const conversationStore = useConversations();
const { theme, toggleTheme } = useTheme();
const chat = useChat({
  onConversationCreated: (conversationId) => {
    conversationStore.ensureConversation(conversationId);
  },
  onTurnCompleted: (conversationId, turnId) =>
    conversationStore.requestAutomaticTitle(conversationId, turnId),
});

const {
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
} = chat;

const {
  conversations,
  activeConversationId,
  loading: conversationsLoading,
  errorMessage: conversationsError,
  loadConversations,
  refreshConversations,
  selectConversation,
  setActiveConversation,
  startNewConversation,
  renameConversation,
  deleteConversation,
  dismissError: dismissConversationError,
} = conversationStore;

const draft = ref("");
const followOutput = ref(true);
const messageList = ref<InstanceType<typeof VirtualMessageList> | null>(null);
const mobileSidebarOpen = ref(false);
const renameTarget = ref<ConversationSummary | null>(null);
const renameSaving = ref(false);
const renameError = ref<string | null>(null);
const deletingId = ref<string | null>(null);

const statusText = computed(() => {
  if (streamState.value === "connecting") {
    return "正在连接";
  }
  if (streamState.value === "reasoning") {
    return "正在深度思考";
  }
  if (streamState.value === "streaming") {
    return "正在生成";
  }
  if (streamState.value === "draining") {
    return "整理回答";
  }
  return "本地就绪";
});

function resetView(): void {
  draft.value = "";
  followOutput.value = true;
  void nextTick(() => {
    messageList.value?.scrollToBottom("auto");
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.focus();
  });
}

function submit(): void {
  const content = draft.value.trim();
  if (!content || isGenerating.value) {
    return;
  }
  draft.value = "";
  followOutput.value = true;
  void sendMessage(content, reasoningLevel.value);
}

async function loadSelectedConversation(): Promise<void> {
  await loadChat(activeConversationId.value);
  await nextTick();
  messageList.value?.scrollToBottom("auto");
}

async function chooseConversation(nextId: string): Promise<void> {
  if (isGenerating.value || nextId === activeConversationId.value) {
    mobileSidebarOpen.value = false;
    return;
  }
  if (!selectConversation(nextId)) {
    return;
  }
  mobileSidebarOpen.value = false;
  resetView();
  await loadChat(nextId);
}

async function createNewConversation(): Promise<void> {
  if (isGenerating.value) {
    return;
  }
  const draftBeforeRefresh = draft.value;
  await refreshConversations();
  const preserveDraft = draft.value !== draftBeforeRefresh;
  startNewConversation();
  clearChat();
  mobileSidebarOpen.value = false;
  if (preserveDraft) {
    followOutput.value = true;
    void nextTick(() => {
      messageList.value?.scrollToBottom("auto");
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.focus();
    });
  } else {
    resetView();
  }
}

function openRename(conversation: ConversationSummary): void {
  if (isGenerating.value) {
    return;
  }
  renameTarget.value = conversation;
  renameError.value = null;
}

function closeRename(): void {
  if (renameSaving.value) {
    return;
  }
  renameTarget.value = null;
  renameError.value = null;
}

async function saveRename(title: string): Promise<void> {
  if (!renameTarget.value) {
    return;
  }
  renameSaving.value = true;
  renameError.value = null;
  try {
    await renameConversation(renameTarget.value.id, title);
    renameTarget.value = null;
  } catch (error) {
    renameError.value =
      error instanceof Error ? error.message : "重命名失败";
  } finally {
    renameSaving.value = false;
  }
}

async function confirmDelete(conversationIdToDelete: string): Promise<void> {
  if (isGenerating.value || deletingId.value) {
    return;
  }
  const wasActive = activeConversationId.value === conversationIdToDelete;
  deletingId.value = conversationIdToDelete;
  try {
    const nextId = await deleteConversation(conversationIdToDelete);
    if (wasActive) {
      resetView();
      if (nextId) {
        await loadChat(nextId);
      } else {
        clearChat();
      }
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "删除会话失败";
  } finally {
    deletingId.value = null;
  }
}

watch(conversationId, (nextId) => {
  if (nextId !== activeConversationId.value) {
    setActiveConversation(nextId);
  }
});

onMounted(async () => {
  await loadConversations();
  await loadSelectedConversation();
});
</script>

<template>
  <div class="app-shell">
    <div class="app-layout">
      <ConversationSidebar
        :conversations="conversations"
        :active-conversation-id="activeConversationId"
        :disabled="isGenerating"
        :mobile-open="mobileSidebarOpen"
        :deleting-id="deletingId"
        @select="chooseConversation"
        @new="createNewConversation"
        @rename="openRename"
        @delete="confirmDelete"
        @close="mobileSidebarOpen = false"
      />
      <button
        v-if="mobileSidebarOpen"
        class="sidebar-overlay"
        type="button"
        aria-label="关闭会话列表"
        @click="mobileSidebarOpen = false"
      />

      <section class="chat-pane">
        <header class="topbar">
          <div class="brand-group">
            <button
              class="mobile-sidebar-trigger"
              type="button"
              aria-label="打开会话列表"
              @click="mobileSidebarOpen = true"
            >
              <Menu :size="19" />
            </button>
            <div class="brand-mark" aria-hidden="true">流</div>
            <div>
              <div class="brand-name">流光</div>
              <div class="brand-subtitle">LOCAL AI CONVERSATION</div>
            </div>
          </div>

          <div class="model-group">
            <div class="runtime-status">
              <span class="status-dot" :class="{ active: isGenerating }" />
              {{ statusText }}
            </div>
            <ThemeToggle :theme="theme" @toggle="toggleTheme" />
            <ReasoningSelector
              :model="model"
              :model-value="reasoningLevel"
              :levels="reasoningLevels"
              :disabled="isGenerating"
              @update:model-value="setReasoningLevel"
            />
            <button
              class="topbar-new-button button-primary"
              type="button"
              :disabled="isGenerating"
              :title="isGenerating ? '请先停止当前回答' : '新对话'"
              aria-label="新对话"
              @click="createNewConversation"
            >
              <Plus :size="16" />
              <span>新对话</span>
            </button>
          </div>
        </header>

        <VirtualMessageList
          ref="messageList"
          :messages="messages"
          :stream-state="streamState"
          :loading="loading || conversationsLoading"
          :conversation-key="activeConversationId ?? 'new'"
          @follow-change="followOutput = $event"
        >
          <template #empty>
            <EmptyState />
          </template>
        </VirtualMessageList>

        <button
          v-if="!followOutput && messages.length > 0"
          class="back-to-bottom"
          type="button"
          aria-label="回到底部"
          @click="messageList?.scrollToBottom()"
        >
          <ArrowDown :size="17" />
        </button>

        <div class="composer-region">
          <div v-if="errorMessage || conversationsError" class="error-banner" role="alert">
            <AlertCircle :size="16" />
            <span>{{ errorMessage || conversationsError }}</span>
            <button
              type="button"
              aria-label="关闭错误提示"
              @click="errorMessage ? dismissError() : dismissConversationError()"
            >
              <X :size="15" />
            </button>
          </div>
          <ChatComposer
            v-model="draft"
            :generating="isGenerating"
            @send="submit"
            @stop="stopGeneration"
          />
          <p class="composer-note">AI 可能会犯错，请核对重要信息 · 对话保存在本机</p>
        </div>
      </section>
    </div>

    <RenameConversationModal
      :open="renameTarget !== null"
      :conversation="renameTarget"
      :saving="renameSaving"
      :error-message="renameError"
      @close="closeRename"
      @save="saveRename"
    />
  </div>
</template>
