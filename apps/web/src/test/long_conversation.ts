import type { ChatMessage } from "@ai-chat/shared";
import type { RenderedChatMessage } from "../composables/use_chat";

function timestamp(index: number): string {
  return new Date(index * 1_000).toISOString();
}

function answerFor(index: number): string {
  if (index % 11 === 0) {
    return [
      `## 历史回答 ${index}`,
      "",
      "这是一段包含列表、引用和行内 `virtualizer` 的长回答。",
      "",
      "- 保留滚动锚点",
      "- 测量动态高度",
      "",
      "> 历史消息离开视口后可以安全卸载。",
      "",
      "```ts",
      `const messageIndex = ${index};`,
      "console.log(messageIndex);",
      "```",
    ].join("\n");
  }
  if (index % 7 === 0) {
    return `回答 ${index}：包含一段较长的多语言代码说明，以及用于验证换行和动态尺寸的重复文本。`.repeat(
      3,
    );
  }
  return `回答 ${index}：这是用于虚拟列表回归的历史内容。`;
}

export function createLongConversation(
  count: number,
  seed = "virtual-list",
): RenderedChatMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    const status =
      role === "assistant" && index % 29 === 0
        ? "error"
        : role === "assistant" && index % 23 === 0
          ? "stopped"
          : "completed";
    const message: ChatMessage = {
      id: `${seed}-message-${index}`,
      conversationId: `${seed}-conversation`,
      turnId: `${seed}-turn-${Math.floor(index / 2)}`,
      position: index,
      role,
      content: role === "user" ? `问题 ${index}：请继续分析这个主题。` : answerFor(index),
      reasoningContent:
        role === "assistant" && index % 5 === 1
          ? `思考过程 ${index}：先拆分约束，再检查第 ${index} 条消息的上下文。`
          : null,
      reasoningDurationMs:
        role === "assistant" && index % 5 === 1 ? 1_200 : null,
      status,
      model: role === "assistant" ? "deepseek-v4-flash" : null,
      reasoningLevel: role === "assistant" && index % 5 === 1 ? "high" : null,
      finishReason: status === "completed" ? "stop" : null,
      usage: null,
      errorCode: status === "error" ? "UPSTREAM_UNAVAILABLE" : null,
      createdAt: timestamp(index),
      updatedAt: timestamp(index),
    };
    return { ...message, renderKey: `${seed}-render-${index}` };
  });
}
