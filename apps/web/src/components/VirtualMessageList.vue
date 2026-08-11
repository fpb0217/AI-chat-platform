<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import {
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/vue-virtual";
import type {
  RenderedChatMessage,
  StreamState,
} from "../composables/use_chat";
import ChatMessageRow from "./ChatMessage.vue";
import QueryScrollNavigator from "./QueryScrollNavigator.vue";
import {
  activeQueryIndexForMessage,
  createQueryNavigationItems,
} from "./query_scroll_navigator";
import {
  BOTTOM_THRESHOLD,
  estimateMessageSize,
  MESSAGE_LIST_GAP,
  MESSAGE_LIST_OVERSCAN,
} from "./virtual_message_list";

interface VirtualMessageListExpose {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (index: number) => void;
}

const props = withDefaults(
  defineProps<{
    messages: RenderedChatMessage[];
    streamState: StreamState;
    loading?: boolean;
    conversationKey?: string | null;
  }>(),
  {
    loading: false,
    conversationKey: null,
  },
);

const emit = defineEmits<{
  "follow-change": [following: boolean];
}>();

const scrollElement = ref<HTMLElement | null>(null);
const followOutput = ref(true);
const activeMessageIndex = ref<number | null>(null);
const reasoningOpenStates = ref(new Map<string, boolean>());
const newMessageKeys = ref(new Set<string>());
const rowElements = new Map<string, HTMLElement>();
const knownMessageKeys = new Set<string>();

let messageKeysInitialized = false;
let previousScrollTop = 0;
let previousMaxScrollTop = 0;
let lastTotalSize = 0;
let followFrame: number | null = null;
let navigationSyncFrame: number | null = null;
let pendingFollowReposition = false;
let userScrollIntentUntil = 0;
let requestedFollowBehavior: ScrollBehavior = "auto";

function setFollowOutput(following: boolean): void {
  if (followOutput.value === following) {
    return;
  }
  followOutput.value = following;
  emit("follow-change", following);
}

function getMaxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function updateScrollBaseline(element: HTMLElement): void {
  previousScrollTop = element.scrollTop;
  previousMaxScrollTop = getMaxScrollTop(element);
}

function scrollToBottomNow(behavior: ScrollBehavior): void {
  const element = scrollElement.value;
  if (!element || props.messages.length === 0) {
    return;
  }

  const measuredTarget = getMaxScrollTop(element);
  const estimatedTarget = Math.max(
    0,
    virtualizer.value.getTotalSize() - element.clientHeight,
  );
  const target = measuredTarget > 0 ? measuredTarget : estimatedTarget;

  if (behavior === "smooth" && typeof element.scrollTo === "function") {
    element.scrollTo({ top: target, behavior });
  } else {
    element.scrollTop = target;
  }
  updateScrollBaseline(element);
  pendingFollowReposition = false;
}

function requestFollow(behavior: ScrollBehavior = "auto"): void {
  if (!followOutput.value || props.messages.length === 0) {
    return;
  }
  requestedFollowBehavior = behavior;
  if (followFrame !== null) {
    return;
  }

  followFrame = window.requestAnimationFrame(() => {
    followFrame = null;
    if (followOutput.value) {
      scrollToBottomNow(requestedFollowBehavior);
    }
  });
}

function syncActiveMessageIndex(): void {
  const element = scrollElement.value;
  if (!element || props.messages.length === 0) {
    activeMessageIndex.value = null;
    return;
  }

  const activationOffset = Math.min(
    72,
    Math.max(1, Math.round(element.clientHeight * 0.16)),
  );
  const readingOffset = Math.min(
    getMaxScrollTop(element),
    element.scrollTop + activationOffset,
  );
  const virtualItems = virtualizer.value.getVirtualItems();
  const visibleItem = virtualItems.find(
    (item) => item.end > readingOffset,
  );

  activeMessageIndex.value =
    visibleItem?.index ??
    virtualItems.at(-1)?.index ??
    Math.max(0, props.messages.length - 1);
}

function requestNavigationSync(): void {
  if (navigationSyncFrame !== null) {
    return;
  }

  navigationSyncFrame = window.requestAnimationFrame(() => {
    navigationSyncFrame = null;
    syncActiveMessageIndex();
  });
}

function recordUserScrollIntent(): void {
  userScrollIntentUntil = performance.now() + 600;
}

function hasUserScrollIntent(): boolean {
  return performance.now() <= userScrollIntentUntil;
}

function handleScroll(): void {
  const element = scrollElement.value;
  if (!element) {
    return;
  }

  const currentScrollTop = element.scrollTop;
  const currentMaxScrollTop = getMaxScrollTop(element);
  const distance = currentMaxScrollTop - currentScrollTop;
  const previousDistance = Math.max(
    0,
    previousMaxScrollTop - previousScrollTop,
  );
  const movedUp = currentScrollTop < previousScrollTop - 1;
  const movedWithShrinkingContent =
    currentMaxScrollTop < previousMaxScrollTop &&
    distance <= previousDistance + 1;
  const movedDuringFollowReposition =
    pendingFollowReposition && distance <= previousDistance + 1;

  if (
    movedUp &&
    !movedWithShrinkingContent &&
    !movedDuringFollowReposition &&
    hasUserScrollIntent()
  ) {
    setFollowOutput(false);
  } else if (distance <= BOTTOM_THRESHOLD) {
    setFollowOutput(true);
  }

  previousScrollTop = currentScrollTop;
  previousMaxScrollTop = currentMaxScrollTop;
  syncActiveMessageIndex();
  requestNavigationSync();
}

function setRowElement(
  element: Element | ComponentPublicInstance | null,
  renderKey: string,
): void {
  if (element instanceof HTMLElement) {
    rowElements.set(renderKey, element);
    virtualizer.value.measureElement(element);
    return;
  }
  rowElements.delete(renderKey);
}

function measureMountedRows(): void {
  for (const element of rowElements.values()) {
    virtualizer.value.measureElement(element);
  }
}

function syncMessageKeys(): void {
  const currentKeys = new Set(
    props.messages.map((message) => message.renderKey),
  );

  if (currentKeys.size === 0) {
    knownMessageKeys.clear();
    newMessageKeys.value = new Set();
    messageKeysInitialized = false;
    return;
  }

  if (!messageKeysInitialized) {
    knownMessageKeys.clear();
    for (const key of currentKeys) {
      knownMessageKeys.add(key);
    }
    newMessageKeys.value = new Set();
    messageKeysInitialized = true;
    return;
  }

  const nextNewKeys = new Set(newMessageKeys.value);
  for (const key of currentKeys) {
    if (!knownMessageKeys.has(key)) {
      nextNewKeys.add(key);
    }
  }
  for (const key of knownMessageKeys) {
    if (!currentKeys.has(key)) {
      nextNewKeys.delete(key);
    }
  }
  knownMessageKeys.clear();
  for (const key of currentKeys) {
    knownMessageKeys.add(key);
  }
  newMessageKeys.value = nextNewKeys;
}

function resetSessionState(): void {
  if (followFrame !== null) {
    window.cancelAnimationFrame(followFrame);
    followFrame = null;
  }
  setFollowOutput(true);
  reasoningOpenStates.value = new Map();
  newMessageKeys.value = new Set();
  knownMessageKeys.clear();
  messageKeysInitialized = false;
  rowElements.clear();
  previousScrollTop = 0;
  previousMaxScrollTop = 0;
  lastTotalSize = 0;
  pendingFollowReposition = false;
  userScrollIntentUntil = 0;
  activeMessageIndex.value = null;
  virtualizer.value.measure();
  syncMessageKeys();
  requestNavigationSync();
}

function handleVirtualizerChange(
  instance: Virtualizer<HTMLElement, HTMLElement>,
  _sync: boolean,
): void {
  const nextTotalSize = instance.getTotalSize();
  const sizeChanged = nextTotalSize !== lastTotalSize;
  lastTotalSize = nextTotalSize;
  if (sizeChanged && followOutput.value) {
    pendingFollowReposition = true;
    requestFollow("auto");
  }
  requestNavigationSync();
}

function handleReasoningOpenChange(renderKey: string, open: boolean): void {
  const nextStates = new Map(reasoningOpenStates.value);
  nextStates.set(renderKey, open);
  reasoningOpenStates.value = nextStates;
  void nextTick(() => {
    measureMountedRows();
    requestFollow("auto");
  });
}

function reasoningOpen(renderKey: string): boolean | undefined {
  return reasoningOpenStates.value.get(renderKey);
}

function reasoningOpenForMessage(index: number): boolean {
  const message = messageAt(index);
  return reasoningOpen(message.renderKey) ?? isReasoningActive(message);
}

function isReasoningActive(message: RenderedChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.status === "streaming" &&
    props.streamState === "reasoning"
  );
}

function messageAt(index: number): RenderedChatMessage {
  const message = props.messages[index];
  if (!message) {
    throw new Error(`Virtual message index ${index} is out of range`);
  }
  return message;
}

const virtualizerOptions = computed(() => ({
  count: props.messages.length,
  getScrollElement: () => scrollElement.value,
  estimateSize: (index: number) => estimateMessageSize(props.messages[index]),
  getItemKey: (index: number) =>
    props.messages[index]?.renderKey ?? `message-${index}`,
  overscan: MESSAGE_LIST_OVERSCAN,
  gap: MESSAGE_LIST_GAP,
  useAnimationFrameWithResizeObserver: true,
  onChange: handleVirtualizerChange,
}));

const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(
  virtualizerOptions,
);
const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
const queryNavigationItems = computed(() =>
  createQueryNavigationItems(props.messages),
);
const activeQueryIndex = computed(() =>
  activeQueryIndexForMessage(
    queryNavigationItems.value,
    activeMessageIndex.value,
  ),
);
const liveAnnouncement = computed(() => {
  if (props.streamState === "reasoning") {
    return "正在思考";
  }
  if (props.streamState === "streaming") {
    return "正在生成回答";
  }
  if (props.streamState === "draining") {
    return "正在整理回答";
  }
  return "";
});

const tailSignal = computed(() => {
  const tail = props.messages[props.messages.length - 1];
  return [
    props.messages.length,
    tail?.renderKey ?? "",
    tail?.content.length ?? 0,
    tail?.reasoningContent?.length ?? 0,
    tail?.status ?? "",
    props.streamState,
  ].join(":");
});

function scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
  setFollowOutput(true);
  scrollToBottomNow(behavior);
}

function scrollToMessage(index: number): void {
  if (index < 0 || index >= props.messages.length) {
    return;
  }

  setFollowOutput(false);
  virtualizer.value.scrollToIndex(index, {
    align: "start",
    behavior: "auto",
  });
  void nextTick(() => {
    measureMountedRows();
    virtualizer.value.scrollToIndex(index, {
      align: "start",
      behavior: "auto",
    });
    const element = scrollElement.value;
    if (element) {
      updateScrollBaseline(element);
    }
    syncActiveMessageIndex();
    requestNavigationSync();
  });
}

watch(
  () => props.conversationKey,
  () => {
    resetSessionState();
  },
  { flush: "post" },
);

watch(
  () => props.messages.length,
  () => {
    syncMessageKeys();
    if (props.messages.length > 0 && followOutput.value) {
      requestFollow("auto");
    }
    requestNavigationSync();
  },
  { immediate: true, flush: "post" },
);

watch(
  tailSignal,
  async () => {
    await nextTick();
    measureMountedRows();
    requestFollow("auto");
  },
  { flush: "post" },
);

onMounted(() => {
  void nextTick(() => {
    if (props.messages.length > 0) {
      requestFollow("auto");
    }
    requestNavigationSync();
  });
});

onBeforeUnmount(() => {
  if (followFrame !== null) {
    window.cancelAnimationFrame(followFrame);
  }
  if (navigationSyncFrame !== null) {
    window.cancelAnimationFrame(navigationSyncFrame);
  }
});

defineExpose<VirtualMessageListExpose>({ scrollToBottom, scrollToMessage });
</script>

<template>
  <div class="conversation-region">
    <main
      ref="scrollElement"
      class="conversation-scroll"
      :data-message-count="messages.length"
      :data-virtual-total-size="Math.round(totalSize)"
      @scroll="handleScroll"
      @wheel="recordUserScrollIntent"
      @pointerdown="recordUserScrollIntent"
      @touchstart="recordUserScrollIntent"
    >
      <div class="conversation-column">
        <div
          v-if="loading"
          class="loading-state"
          aria-label="正在加载对话"
        >
          <span />
          <span />
          <span />
        </div>
        <div
          v-else-if="messages.length === 0"
          class="empty-state-host"
        >
          <slot name="empty" />
        </div>
        <div
          v-else
          class="message-list"
          role="list"
          :aria-label="`对话消息，共 ${messages.length} 条`"
          :aria-setsize="messages.length"
          :style="{ height: `${Math.max(0, totalSize)}px` }"
        >
          <div
            v-for="virtualRow in virtualItems"
            :key="String(virtualRow.key)"
            :ref="
              (element) =>
                setRowElement(
                  element,
                  String(virtualRow.key),
                )
            "
            class="virtual-message-row"
            :data-index="virtualRow.index"
            :data-virtual-index="virtualRow.index"
            :data-render-key="String(virtualRow.key)"
            :style="{ transform: `translateY(${virtualRow.start}px)` }"
          >
            <ChatMessageRow
              :message="messageAt(virtualRow.index)"
              :reasoning-active="isReasoningActive(messageAt(virtualRow.index))"
              :reasoning-open="reasoningOpenForMessage(virtualRow.index)"
              :reasoning-open-controlled="true"
              :animate="newMessageKeys.has(messageAt(virtualRow.index).renderKey)"
              :virtual-index="virtualRow.index"
              :message-count="messages.length"
              @reasoning-open-change="
                handleReasoningOpenChange(
                  messageAt(virtualRow.index).renderKey,
                  $event,
                )
              "
            />
          </div>
        </div>
      </div>
      <div class="sr-only" aria-live="polite" aria-atomic="true">
        {{ liveAnnouncement }}
      </div>
    </main>

    <QueryScrollNavigator
      :items="queryNavigationItems"
      :active-index="activeQueryIndex"
      :stream-state="streamState"
      :navigation-key="conversationKey"
      @navigate="scrollToMessage"
    />
  </div>
</template>
