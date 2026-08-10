<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { MAX_MANUAL_TITLE_LENGTH, graphemeCount, type ConversationSummary } from "@ai-chat/shared";
import { X } from "lucide-vue-next";

const props = defineProps<{
  open: boolean;
  conversation: ConversationSummary | null;
  saving: boolean;
  errorMessage: string | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [title: string];
}>();

const input = ref("");
const inputElement = ref<HTMLInputElement | null>(null);
const localError = ref<string | null>(null);
const characterCount = computed(() => graphemeCount(input.value));

async function focusInput(): Promise<void> {
  await nextTick();
  inputElement.value?.focus();
  inputElement.value?.select();
}

watch(
  () => [props.open, props.conversation?.id] as const,
  async ([open]) => {
    if (!open) {
      return;
    }
    input.value = props.conversation?.title ?? "";
    localError.value = null;
    await focusInput();
  },
  { immediate: true },
);

watch(
  () => props.errorMessage,
  (message) => {
    if (message) {
      localError.value = message;
    }
  },
);

function submit(): void {
  const title = input.value.trim();
  if (!title) {
    localError.value = "标题不能为空";
    return;
  }
  if (characterCount.value > MAX_MANUAL_TITLE_LENGTH) {
    localError.value = `标题不能超过 ${MAX_MANUAL_TITLE_LENGTH} 个字符`;
    return;
  }
  localError.value = null;
  emit("save", title);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      role="presentation"
      @mousedown.self="emit('close')"
    >
      <section
        class="rename-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-modal-title"
        @mousedown.stop
      >
        <div class="rename-modal-header">
          <div>
            <p class="sidebar-eyebrow">EDIT CONVERSATION</p>
            <h2 id="rename-modal-title">重命名会话</h2>
          </div>
          <button type="button" aria-label="关闭重命名窗口" @click="emit('close')">
            <X :size="17" />
          </button>
        </div>
        <label class="rename-input-label" for="conversation-title-input">会话标题</label>
        <input
          id="conversation-title-input"
          ref="inputElement"
          v-model="input"
          class="rename-input"
          type="text"
          :maxlength="MAX_MANUAL_TITLE_LENGTH"
          :disabled="saving"
          aria-describedby="rename-modal-hint rename-modal-error"
          @keydown="handleKeydown"
        >
        <div id="rename-modal-hint" class="rename-input-meta">
          <span>标题会以普通文本保存</span>
          <span>{{ characterCount }} / {{ MAX_MANUAL_TITLE_LENGTH }}</span>
        </div>
        <p v-if="localError" id="rename-modal-error" class="rename-modal-error" role="alert">
          {{ localError }}
        </p>
        <div class="rename-modal-actions">
          <button type="button" class="button-secondary" :disabled="saving" @click="emit('close')">
            取消
          </button>
          <button type="button" class="button-primary" :disabled="saving" @click="submit">
            {{ saving ? "保存中…" : "保存" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
