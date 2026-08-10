<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ArrowUp, Square } from "lucide-vue-next";
import { MAX_MESSAGE_LENGTH } from "@ai-chat/shared";

const props = defineProps<{
  modelValue: string;
  generating: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);

function resize(): void {
  const element = textarea.value;
  if (!element) {
    return;
  }
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 192)}px`;
}

function update(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  resize();
}

function handleKeydown(event: KeyboardEvent): void {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    !props.generating
  ) {
    event.preventDefault();
    emit("send");
  }
}

watch(
  () => props.modelValue,
  async () => {
    await nextTick();
    resize();
  },
);
</script>

<template>
  <div class="composer-shell">
    <textarea
      ref="textarea"
      :value="modelValue"
      :maxlength="MAX_MESSAGE_LENGTH"
      :disabled="generating"
      rows="1"
      aria-label="输入消息"
      placeholder="向 DeepSeek 提问…"
      @input="update"
      @keydown="handleKeydown"
    />
    <span v-if="modelValue.length > 18_000" class="character-count">
      {{ modelValue.length.toLocaleString() }} / {{ MAX_MESSAGE_LENGTH.toLocaleString() }}
    </span>
    <button
      v-if="generating"
      type="button"
      class="composer-action stop-action button-subtle"
      aria-label="停止生成"
      title="停止生成"
      @click="emit('stop')"
    >
      <Square :size="15" fill="currentColor" />
    </button>
    <button
      v-else
      type="button"
      class="composer-action send-action button-primary"
      :disabled="!modelValue.trim()"
      aria-label="发送消息"
      title="发送消息"
      @click="emit('send')"
    >
      <ArrowUp :size="19" :stroke-width="2.4" />
    </button>
  </div>
</template>

