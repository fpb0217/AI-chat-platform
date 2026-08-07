<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { ChatMessage } from "@ai-chat/shared";
import { BrainCircuit, ChevronDown, LoaderCircle } from "lucide-vue-next";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  message: ChatMessage;
  active: boolean;
}>();

const open = ref(false);
const reasoningBody = ref<HTMLElement | null>(null);
const reasoningContent = ref<HTMLElement | null>(null);
const followOutput = ref(true);
const panelId = computed(() => `reasoning-${props.message.id}`);
const bottomThreshold = 24;
let previousScrollTop = 0;
let contentResizeObserver: ResizeObserver | null = null;
const hasReasoning = computed(
  () =>
    props.message.role === "assistant" &&
    props.message.reasoningContent !== null,
);

function formatDurationTitle(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return "已思考不到 1 秒";
  }
  const seconds = milliseconds / 1_000;
  return `已思考约 ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
}

const title = computed(() => {
  if (props.active) {
    return "正在思考…";
  }
  if (
    props.message.status === "stopped" &&
    props.message.content.length === 0
  ) {
    return "思考已停止";
  }
  if (
    props.message.status === "error" &&
    props.message.content.length === 0
  ) {
    return "思考过程未完整生成";
  }
  if (props.message.reasoningDurationMs !== null) {
    return formatDurationTitle(props.message.reasoningDurationMs);
  }
  return "思考过程";
});

function scrollToLatestReasoning(): void {
  const element = reasoningBody.value;
  if (!element || !props.active || !open.value || !followOutput.value) {
    return;
  }
  element.scrollTop = element.scrollHeight;
  previousScrollTop = element.scrollTop;
}

function handleReasoningScroll(): void {
  const element = reasoningBody.value;
  if (!element) {
    return;
  }
  const currentScrollTop = element.scrollTop;
  const bottomDistance =
    element.scrollHeight - currentScrollTop - element.clientHeight;

  if (currentScrollTop < previousScrollTop - 1) {
    followOutput.value = false;
  } else if (bottomDistance <= bottomThreshold) {
    followOutput.value = true;
  }
  previousScrollTop = currentScrollTop;
}

function toggleOpen(): void {
  open.value = !open.value;
  if (open.value && props.active) {
    followOutput.value = true;
    void nextTick(scrollToLatestReasoning);
  }
}

watch(
  () => props.active,
  (active, wasActive) => {
    if (active) {
      open.value = true;
      followOutput.value = true;
      previousScrollTop = reasoningBody.value?.scrollTop ?? 0;
      void nextTick(scrollToLatestReasoning);
    } else if (wasActive) {
      open.value = false;
    }
  },
  { immediate: true, flush: "sync" },
);

watch(
  () => props.message.reasoningContent,
  async () => {
    await nextTick();
    scrollToLatestReasoning();
  },
  { flush: "post" },
);

watch(
  reasoningContent,
  (current, previous) => {
    if (!contentResizeObserver) {
      return;
    }
    if (previous) {
      contentResizeObserver.unobserve(previous);
    }
    if (current) {
      contentResizeObserver.observe(current);
    }
  },
  { flush: "post" },
);

onMounted(() => {
  if (typeof ResizeObserver === "undefined") {
    return;
  }
  contentResizeObserver = new ResizeObserver(scrollToLatestReasoning);
  if (reasoningContent.value) {
    contentResizeObserver.observe(reasoningContent.value);
  }
});

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect();
});
</script>

<template>
  <section v-if="hasReasoning" class="reasoning-panel">
    <button
      class="reasoning-toggle"
      type="button"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="toggleOpen"
    >
      <span class="reasoning-title">
        <LoaderCircle
          v-if="active"
          class="reasoning-spinner"
          :size="15"
          aria-hidden="true"
        />
        <BrainCircuit v-else :size="15" aria-hidden="true" />
        <span>{{ title }}</span>
      </span>
      <ChevronDown
        class="reasoning-chevron"
        :class="{ open }"
        :size="16"
        aria-hidden="true"
      />
    </button>

    <div
      v-show="open"
      :id="panelId"
      ref="reasoningBody"
      class="reasoning-body"
      role="region"
      :aria-label="title"
      :aria-busy="active"
      @scroll="handleReasoningScroll"
    >
      <div ref="reasoningContent" class="reasoning-content">
        <MarkdownContent
          :content="message.reasoningContent ?? ''"
          :streaming="active"
          cursor-label="正在思考"
        />
      </div>
    </div>
  </section>
</template>
