<script setup lang="ts">
import { computed } from "vue";
import type { MessageRole } from "@ai-chat/shared";
import type {
  TokenDisplayState,
  TurnTokenDisplay,
} from "../lib/token_usage";

const props = defineProps<{
  role: MessageRole;
  display: TurnTokenDisplay;
}>();

const numberFormatter = new Intl.NumberFormat("zh-CN");

const pending = computed(() => props.display.state === "pending");
const unavailable = computed(() => {
  if (props.display.state !== "unavailable") {
    return false;
  }
  if (props.role === "user") {
    return props.display.inputTokens === null;
  }
  return (
    props.display.answerTokens === null ||
    (props.display.thinkingUsed && props.display.reasoningTokens === null)
  );
});
const displayState = computed<TokenDisplayState>(() => {
  if (pending.value) {
    return "pending";
  }
  return unavailable.value ? "unavailable" : "available";
});
const ariaLabel = computed(() => {
  if (pending.value) {
    return "Token 用量计算中";
  }
  if (unavailable.value) {
    return "本次请求未返回 Token 用量";
  }
  return "Token 用量";
});

function format(tokens: number | null): string {
  if (pending.value) {
    return "计算中…";
  }
  return tokens === null ? "—" : numberFormatter.format(tokens);
}
</script>

<template>
  <div
    class="message-token-usage"
    :class="`message-token-usage-${role}`"
    :data-token-state="displayState"
    role="note"
    :aria-label="ariaLabel"
  >
    <span
      v-if="role === 'user'"
      class="message-token-metric"
      title="包含历史上下文与模型输入开销"
    >
      实际输入 <strong>{{ format(display.inputTokens) }}</strong>
    </span>
    <template v-else>
      <span v-if="display.thinkingUsed" class="message-token-metric">
        思考 <strong>{{ format(display.reasoningTokens) }}</strong>
      </span>
      <span class="message-token-metric">
        正文 <strong>{{ format(display.answerTokens) }}</strong>
      </span>
    </template>
    <span v-if="unavailable" class="sr-only">本次请求未返回 Token 用量</span>
  </div>
</template>
