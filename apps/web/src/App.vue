<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  AlertCircle,
  ArrowDown,
  Check,
  Cpu,
  X,
} from "lucide-vue-next";
import ChatComposer from "./components/ChatComposer.vue";
import ChatMessage from "./components/ChatMessage.vue";
import EmptyState from "./components/EmptyState.vue";
import { useChat } from "./composables/use_chat";

const {
  messages,
  loading,
  streamState,
  isGenerating,
  errorMessage,
  loadChat,
  sendMessage,
  stopGeneration,
  dismissError,
} = useChat();

const draft = ref("");
const scrollArea = ref<HTMLElement | null>(null);
const followOutput = ref(true);
const statusText = computed(() => {
  if (streamState.value === "connecting") {
    return "正在连接";
  }
  if (streamState.value === "streaming") {
    return "正在生成";
  }
  if (streamState.value === "draining") {
    return "整理回答";
  }
  return "本地就绪";
});

function scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
  const element = scrollArea.value;
  if (!element) {
    return;
  }
  followOutput.value = true;
  element.scrollTo({ top: element.scrollHeight, behavior });
}

function handleScroll(): void {
  const element = scrollArea.value;
  if (!element) {
    return;
  }
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  followOutput.value = distance < 96;
}

function submit(): void {
  const content = draft.value.trim();
  if (!content || isGenerating.value) {
    return;
  }
  draft.value = "";
  followOutput.value = true;
  void sendMessage(content);
}

watch(
  () =>
    messages.value
      .map((message) => `${message.id}:${message.content}:${message.status}`)
      .join("|"),
  async () => {
    await nextTick();
    if (followOutput.value) {
      scrollToBottom("auto");
    }
  },
);

onMounted(async () => {
  await loadChat();
  await nextTick();
  scrollToBottom("auto");
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-group">
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
        <div class="model-pill">
          <Cpu :size="14" />
          <span class="model-name-long">DeepSeek V4 Flash</span>
          <span class="model-name-short">V4 Flash</span>
          <span class="model-mode"><Check :size="11" />非思考</span>
        </div>
      </div>
    </header>

    <main ref="scrollArea" class="conversation-scroll" @scroll="handleScroll">
      <div class="conversation-column">
        <div v-if="loading" class="loading-state" aria-label="正在加载对话">
          <span />
          <span />
          <span />
        </div>
        <EmptyState v-else-if="messages.length === 0" />
        <div v-else class="message-list" aria-live="polite">
          <ChatMessage
            v-for="message in messages"
            :key="message.id"
            :message="message"
          />
        </div>
      </div>
    </main>

    <button
      v-if="!followOutput && messages.length > 0"
      class="back-to-bottom"
      type="button"
      aria-label="回到底部"
      @click="scrollToBottom()"
    >
      <ArrowDown :size="17" />
    </button>

    <div class="composer-region">
      <div v-if="errorMessage" class="error-banner" role="alert">
        <AlertCircle :size="16" />
        <span>{{ errorMessage }}</span>
        <button type="button" aria-label="关闭错误提示" @click="dismissError">
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
  </div>
</template>
