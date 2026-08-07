<script setup lang="ts">
import { Code2, MessageSquareText, Sparkles } from "lucide-vue-next";
</script>

<template>
  <section class="empty-state">
    <div class="empty-mark" aria-hidden="true">
      <Sparkles :size="28" :stroke-width="1.7" />
    </div>
    <p class="empty-kicker">LOCAL · STREAMING · PRIVATE</p>
    <h1>现在，想聊点什么？</h1>
    <p class="empty-description">
      回答会从本地服务实时抵达，并以平滑的打字节奏呈现在这里。
    </p>
    <div class="empty-features">
      <div>
        <MessageSquareText :size="17" />
        <span>多轮上下文</span>
      </div>
      <div>
        <Code2 :size="17" />
        <span>Markdown 与代码</span>
      </div>
    </div>
  </section>
</template>

