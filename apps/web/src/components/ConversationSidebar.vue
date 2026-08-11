<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Ellipsis, FilePenLine, MessageSquarePlus, Trash2, X } from "lucide-vue-next";
import type { ConversationSummary } from "@ai-chat/shared";

const props = defineProps<{
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  disabled: boolean;
  mobileOpen: boolean;
  deletingId: string | null;
}>();

const emit = defineEmits<{
  select: [conversationId: string];
  new: [];
  rename: [conversation: ConversationSummary];
  delete: [conversationId: string];
  close: [];
}>();

const openMenuId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);

function closeMenu(): void {
  openMenuId.value = null;
  confirmDeleteId.value = null;
}

function toggleMenu(
  event: MouseEvent,
  conversationId: string,
): void {
  event.stopPropagation();
  if (props.disabled) {
    return;
  }
  if (openMenuId.value === conversationId) {
    closeMenu();
  } else {
    openMenuId.value = conversationId;
    confirmDeleteId.value = null;
    menuButton.value = event.currentTarget as HTMLButtonElement;
  }
}

function selectConversation(conversationId: string): void {
  if (props.disabled) {
    return;
  }
  closeMenu();
  emit("select", conversationId);
  emit("close");
}

function requestRename(conversation: ConversationSummary): void {
  if (props.disabled) {
    return;
  }
  closeMenu();
  emit("rename", conversation);
}

function requestDelete(conversationId: string): void {
  if (props.disabled) {
    return;
  }
  if (confirmDeleteId.value !== conversationId) {
    confirmDeleteId.value = conversationId;
    return;
  }
  closeMenu();
  emit("delete", conversationId);
}

function cancelDelete(): void {
  confirmDeleteId.value = null;
}

function handleDocumentClick(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Element && target.closest(".conversation-item")) {
    return;
  }
  closeMenu();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && openMenuId.value) {
    event.preventDefault();
    closeMenu();
    menuButton.value?.focus();
  }
}

onMounted(() => {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <aside
    class="conversation-sidebar"
    :class="{ 'conversation-sidebar-open': mobileOpen }"
    aria-label="会话列表"
  >
    <div class="sidebar-heading">
      <h2>会话</h2>
      <button
        class="sidebar-close"
        type="button"
        aria-label="关闭会话列表"
        @click="emit('close')"
      >
        <X :size="17" />
      </button>
    </div>

    <button
      class="sidebar-new-button button-primary"
      type="button"
      :disabled="disabled"
      :title="disabled ? '请先停止当前回答' : '新对话'"
      @click="emit('new')"
    >
      <MessageSquarePlus :size="17" />
      <span>新对话</span>
    </button>

    <div class="conversation-list" role="list">
      <p v-if="conversations.length === 0" class="conversation-list-empty">
        还没有历史会话
      </p>
      <div
        v-for="conversation in conversations"
        :key="conversation.id"
        class="conversation-item"
        :class="{
          'conversation-item-active': conversation.id === activeConversationId,
          'conversation-item-menu-open': conversation.id === openMenuId,
        }"
        role="listitem"
      >
        <button
          class="conversation-select"
          type="button"
          :disabled="disabled"
          :aria-current="conversation.id === activeConversationId ? 'page' : undefined"
          :title="conversation.title"
          @click="selectConversation(conversation.id)"
        >
          <span class="conversation-item-dot" aria-hidden="true" />
          <span class="conversation-title">{{ conversation.title }}</span>
        </button>
        <button
          class="conversation-menu-trigger"
          type="button"
          :disabled="disabled"
          :aria-label="`操作：${conversation.title}`"
          aria-haspopup="menu"
          :aria-expanded="conversation.id === openMenuId"
          @click="toggleMenu($event, conversation.id)"
        >
          <Ellipsis :size="17" />
        </button>

        <div
          v-if="conversation.id === openMenuId"
          class="conversation-menu"
          role="menu"
          @click.stop
        >
          <template v-if="conversation.id !== confirmDeleteId">
            <button type="button" role="menuitem" @click="requestRename(conversation)">
              <FilePenLine :size="15" />
              <span>重命名</span>
            </button>
            <button
              type="button"
              role="menuitem"
              class="conversation-menu-danger"
              @click="requestDelete(conversation.id)"
            >
              <Trash2 :size="15" />
              <span>删除</span>
            </button>
          </template>
          <template v-else>
            <p class="conversation-delete-question">确认删除这个会话？</p>
            <button
              type="button"
              role="menuitem"
              class="conversation-menu-danger"
              :disabled="deletingId === conversation.id"
              @click="requestDelete(conversation.id)"
            >
              <Trash2 :size="15" />
              <span>{{ deletingId === conversation.id ? "删除中…" : "确认删除" }}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              :disabled="deletingId === conversation.id"
              @click="cancelDelete"
            >
              <span>取消</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </aside>
</template>
