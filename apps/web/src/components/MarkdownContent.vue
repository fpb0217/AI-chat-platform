<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../lib/markdown";

const props = defineProps<{
  content: string;
  streaming: boolean;
  cursorLabel?: string;
}>();

const rendered = ref("");
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let lastRenderAt = 0;

function updateRendered(): void {
  rendered.value = renderMarkdown(props.content);
  lastRenderAt = performance.now();
  renderTimer = null;
}

watch(
  () => [props.content, props.streaming] as const,
  () => {
    if (!props.streaming) {
      if (renderTimer) {
        clearTimeout(renderTimer);
      }
      updateRendered();
      return;
    }

    const wait = Math.max(0, 33 - (performance.now() - lastRenderAt));
    if (!renderTimer) {
      renderTimer = setTimeout(updateRendered, wait);
    }
  },
  { immediate: true },
);

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-copy-code]");
  if (!button) {
    return;
  }
  const code = button.closest(".code-block")?.querySelector("code")?.textContent;
  if (!code) {
    return;
  }
  await navigator.clipboard.writeText(code);
  const previous = button.textContent;
  button.textContent = "已复制";
  window.setTimeout(() => {
    button.textContent = previous;
  }, 1_200);
}

onBeforeUnmount(() => {
  if (renderTimer) {
    clearTimeout(renderTimer);
  }
});
</script>

<template>
  <div class="markdown-shell">
    <div class="markdown-body" @click="handleClick" v-html="rendered" />
    <span
      v-if="streaming"
      class="typing-cursor"
      :aria-label="cursorLabel ?? '正在生成'"
    />
  </div>
</template>
