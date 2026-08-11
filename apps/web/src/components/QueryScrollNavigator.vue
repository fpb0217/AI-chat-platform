<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { StreamState } from "../composables/use_chat";
import {
  QUERY_NAVIGATOR_VISIBLE_COUNT,
  QUERY_NAVIGATOR_WHEEL_THRESHOLD,
  answerPreview,
  createCenteredQueryWindow,
  isQueryIndexInCenteredWindow,
  queryPreview,
  type QueryNavigationItem,
} from "./query_scroll_navigator";

const QUERY_NAVIGATOR_ITEM_HEIGHT = 10;
const QUERY_NAVIGATOR_ITEM_GAP = 6;
const QUERY_NAVIGATOR_SLOT_PITCH =
  QUERY_NAVIGATOR_ITEM_HEIGHT + QUERY_NAVIGATOR_ITEM_GAP;

const props = withDefaults(
  defineProps<{
    items: QueryNavigationItem[];
    activeIndex: number | null;
    streamState: StreamState;
    navigationKey?: string | null;
  }>(),
  {
    navigationKey: null,
  },
);

const emit = defineEmits<{
  navigate: [messageIndex: number];
}>();

const previewIndex = ref<number | null>(null);
const browsingIndex = ref<number | null>(null);
const visualCenterIndex = ref<number | null>(null);
const wheelDistance = ref(0);
const wheelDirection = ref<1 | -1 | null>(null);
const settleOffset = ref<number | null>(null);
const railSettling = ref(false);
const previewId = "query-scroll-navigator-preview";

let settleFrame: number | null = null;

const targetCenterIndex = computed(() => {
  if (props.items.length === 0) {
    return null;
  }

  const requestedIndex =
    browsingIndex.value ?? props.activeIndex ?? 0;
  return Math.min(
    Math.max(0, requestedIndex),
    props.items.length - 1,
  );
});
const centeredWindow = computed(() =>
  createCenteredQueryWindow(
    visualCenterIndex.value ?? targetCenterIndex.value,
    props.items.length,
  ),
);
const railItems = computed(() =>
  centeredWindow.value.indices.flatMap((index) => {
    const item = props.items[index];
    return item ? [{ index, item }] : [];
  }),
);
const previewItem = computed(() => {
  const index = previewIndex.value;
  return index === null ? null : (props.items[index] ?? null);
});
const previewTitle = computed(() =>
  previewItem.value ? queryPreview(previewItem.value) : "",
);
const previewBody = computed(() =>
  previewItem.value
    ? answerPreview(previewItem.value, props.streamState)
    : "",
);
const railOffset = computed(() => {
  if (settleOffset.value !== null) {
    return settleOffset.value;
  }
  if (wheelDirection.value === null || wheelDistance.value === 0) {
    return 0;
  }

  return (
    -wheelDirection.value *
    (wheelDistance.value / QUERY_NAVIGATOR_WHEEL_THRESHOLD) *
    QUERY_NAVIGATOR_SLOT_PITCH
  );
});

function resetWheelProgress(): void {
  wheelDistance.value = 0;
  wheelDirection.value = null;
}

function cancelSettleAnimation(): void {
  if (settleFrame !== null) {
    window.cancelAnimationFrame(settleFrame);
    settleFrame = null;
  }
  settleOffset.value = null;
  railSettling.value = false;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function moveVisualCenter(
  nextIndex: number | null,
  animateSingleStep: boolean,
): void {
  const previousIndex = visualCenterIndex.value;
  visualCenterIndex.value = nextIndex;

  const delta =
    previousIndex === null || nextIndex === null
      ? 0
      : nextIndex - previousIndex;
  if (
    !animateSingleStep ||
    Math.abs(delta) !== 1 ||
    prefersReducedMotion()
  ) {
    cancelSettleAnimation();
    return;
  }

  cancelSettleAnimation();
  settleOffset.value = Math.sign(delta) * QUERY_NAVIGATOR_SLOT_PITCH;
  void nextTick(() => {
    if (visualCenterIndex.value !== nextIndex) {
      return;
    }
    settleFrame = window.requestAnimationFrame(() => {
      settleFrame = null;
      railSettling.value = true;
      settleOffset.value = 0;
    });
  });
}

function showPreview(index: number): void {
  previewIndex.value = index;
}

function hidePreview(index: number): void {
  if (previewIndex.value === index) {
    previewIndex.value = null;
  }
}

function clearPointerInteraction(): void {
  previewIndex.value = null;
  browsingIndex.value = null;
  resetWheelProgress();
}

function handleNavigate(item: QueryNavigationItem, index: number): void {
  showPreview(index);
  emit("navigate", item.messageIndex);
}

function handleKeydown(event: KeyboardEvent, index: number): void {
  if (event.key !== "Escape") {
    return;
  }
  event.preventDefault();
  hidePreview(index);
  browsingIndex.value = null;
  resetWheelProgress();
}

function normalizedWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === 1) {
    return event.deltaY * QUERY_NAVIGATOR_SLOT_PITCH;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * 120;
  }
  return event.deltaY;
}

function handleWheel(event: WheelEvent): void {
  const deltaY = normalizedWheelDelta(event);
  if (
    props.items.length <= QUERY_NAVIGATOR_VISIBLE_COUNT ||
    deltaY === 0
  ) {
    return;
  }

  const direction = deltaY > 0 ? 1 : -1;
  const currentIndex =
    visualCenterIndex.value ?? targetCenterIndex.value;
  if (currentIndex === null) {
    return;
  }

  const nextIndex = Math.min(
    Math.max(0, currentIndex + direction),
    props.items.length - 1,
  );
  if (nextIndex === currentIndex) {
    resetWheelProgress();
    return;
  }

  event.preventDefault();
  if (wheelDirection.value !== direction) {
    cancelSettleAnimation();
    wheelDistance.value = 0;
    wheelDirection.value = direction;
  }

  const distanceBefore = wheelDistance.value;
  const contribution = Math.min(
    Math.abs(deltaY),
    QUERY_NAVIGATOR_WHEEL_THRESHOLD,
  );
  wheelDistance.value = Math.min(
    QUERY_NAVIGATOR_WHEEL_THRESHOLD,
    wheelDistance.value + contribution,
  );
  if (wheelDistance.value < QUERY_NAVIGATOR_WHEEL_THRESHOLD) {
    return;
  }

  const isDiscreteStep =
    distanceBefore === 0 &&
    contribution >= QUERY_NAVIGATOR_WHEEL_THRESHOLD;
  moveVisualCenter(nextIndex, isDiscreteStep);
  browsingIndex.value = nextIndex;
  previewIndex.value = nextIndex;
  resetWheelProgress();
}

function handleRailTransitionEnd(event: TransitionEvent): void {
  if (event.target !== event.currentTarget || event.propertyName !== "transform") {
    return;
  }
  settleOffset.value = null;
  railSettling.value = false;
}

function isVisibleQueryIndex(index: number): boolean {
  return isQueryIndexInCenteredWindow(index, centeredWindow.value);
}

function itemPosition(index: number): string {
  return `${
    (index - centeredWindow.value.visibleStart) *
    QUERY_NAVIGATOR_SLOT_PITCH
  }px`;
}

function bufferSide(index: number): "above" | "below" | undefined {
  if (isVisibleQueryIndex(index)) {
    return undefined;
  }
  return index < centeredWindow.value.visibleStart ? "above" : "below";
}

watch(
  targetCenterIndex,
  (nextIndex) => {
    moveVisualCenter(nextIndex, true);
  },
  { immediate: true },
);

watch(
  () => props.activeIndex,
  (activeIndex, previousActiveIndex) => {
    if (
      browsingIndex.value !== null &&
      activeIndex !== previousActiveIndex &&
      activeIndex !== browsingIndex.value
    ) {
      browsingIndex.value = null;
    }
  },
);

watch(
  () => props.items.length,
  (itemCount) => {
    if (browsingIndex.value !== null && browsingIndex.value >= itemCount) {
      browsingIndex.value = null;
    }
    if (previewIndex.value !== null && previewIndex.value >= itemCount) {
      previewIndex.value = null;
    }
  },
);

watch(
  () => props.navigationKey,
  () => {
    browsingIndex.value = null;
    previewIndex.value = null;
    resetWheelProgress();
    cancelSettleAnimation();
    visualCenterIndex.value = targetCenterIndex.value;
  },
);

onBeforeUnmount(() => {
  if (settleFrame !== null) {
    window.cancelAnimationFrame(settleFrame);
  }
});
</script>

<template>
  <aside
    v-if="items.length > 0"
    class="query-scroll-navigator"
    aria-label="用户问题定位"
    data-query-navigator
    @wheel="handleWheel"
    @pointerleave="clearPointerInteraction"
  >
    <div class="query-scroll-navigator-viewport">
      <div
        class="query-scroll-navigator-rail"
        :class="{
          'query-scroll-navigator-rail-settling': railSettling,
        }"
        :style="{ transform: `translateY(${railOffset}px)` }"
        :data-query-rail-offset="railOffset"
        data-query-rail
        @transitionend="handleRailTransitionEnd"
      >
        <button
          v-for="{ item, index } in railItems"
          :key="item.key"
          class="query-scroll-navigator-item"
          :class="{
            'query-scroll-navigator-item-active':
              visualCenterIndex === index,
          }"
          type="button"
          :style="{ transform: `translateY(${itemPosition(index)})` }"
          :data-query-index="index"
          :data-query-slot="index - centeredWindow.visibleStart"
          :data-query-visible-index="isVisibleQueryIndex(index) ? index : undefined"
          :data-query-buffer="bufferSide(index)"
          :aria-current="
            visualCenterIndex === index ? 'location' : undefined
          "
          :aria-describedby="
            previewIndex === index ? previewId : undefined
          "
          :aria-hidden="isVisibleQueryIndex(index) ? undefined : 'true'"
          :tabindex="isVisibleQueryIndex(index) ? 0 : -1"
          :aria-label="`定位到第 ${index + 1} 个问题：${queryPreview(item)}`"
          @click="handleNavigate(item, index)"
          @focus="showPreview(index)"
          @blur="hidePreview(index)"
          @pointerenter="showPreview(index)"
          @keydown="handleKeydown($event, index)"
        >
          <span class="query-scroll-navigator-line" />
        </button>
      </div>

      <div
        v-if="visualCenterIndex !== null"
        class="query-scroll-navigator-center-marker"
        aria-hidden="true"
        data-query-center-marker
      >
        <span class="query-scroll-navigator-line" />
      </div>
    </div>

    <div
      v-if="previewItem"
      :id="previewId"
      class="query-scroll-navigator-preview"
      role="tooltip"
      data-query-preview
    >
      <strong class="query-scroll-navigator-preview-query">
        {{ previewTitle }}
      </strong>
      <span class="query-scroll-navigator-preview-answer">
        {{ previewBody }}
      </span>
    </div>
  </aside>
</template>
