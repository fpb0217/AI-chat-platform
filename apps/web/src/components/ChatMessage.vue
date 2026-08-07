<script setup lang="ts">
import type { ChatMessage } from "@ai-chat/shared";
import { Bot, CircleAlert, CircleStop, UserRound } from "lucide-vue-next";
import MarkdownContent from "./MarkdownContent.vue";

defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <article
    class="message-row"
    :class="message.role === 'user' ? 'message-row-user' : 'message-row-assistant'"
    :data-message-id="message.id"
  >
    <div
      class="message-avatar"
      :class="message.role === 'user' ? 'message-avatar-user' : 'message-avatar-ai'"
      aria-hidden="true"
    >
      <UserRound v-if="message.role === 'user'" :size="17" />
      <Bot v-else :size="18" />
    </div>

    <div class="message-content">
      <div class="message-author">
        {{ message.role === "user" ? "你" : "DeepSeek" }}
      </div>
      <div v-if="message.role === 'user'" class="user-bubble">
        {{ message.content }}
      </div>
      <MarkdownContent
        v-else
        :content="message.content"
        :streaming="message.status === 'streaming'"
      />
      <div
        v-if="message.role === 'assistant' && message.status === 'stopped'"
        class="message-status"
      >
        <CircleStop :size="13" />
        已停止生成
      </div>
      <div
        v-if="message.role === 'assistant' && message.status === 'error'"
        class="message-status message-status-error"
      >
        <CircleAlert :size="13" />
        回答未完整生成
      </div>
    </div>
  </article>
</template>

