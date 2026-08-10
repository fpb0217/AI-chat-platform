import { defineComponent, h, type ComponentPublicInstance } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { ConversationListResponse, ConversationSummary } from "@ai-chat/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_CONVERSATION_KEY, useConversations } from "./use_conversations";

const first: ConversationSummary = {
  id: "first",
  title: "第一个会话",
  titleSource: "auto",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:01:00.000Z",
};

const second: ConversationSummary = {
  id: "second",
  title: "第二个会话",
  titleSource: "manual",
  createdAt: "2026-08-10T00:02:00.000Z",
  updatedAt: "2026-08-10T00:03:00.000Z",
};

type ConversationsController = ReturnType<typeof useConversations>;

function mountConversations(): {
  conversations: ConversationsController;
  wrapper: VueWrapper<ComponentPublicInstance>;
} {
  let controller: ConversationsController | undefined;
  const component = defineComponent({
    setup() {
      controller = useConversations();
      return () => h("div");
    },
  });
  const wrapper = mount(component);
  if (!controller) {
    throw new Error("Conversation composable did not initialize");
  }
  return { conversations: controller, wrapper };
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useConversations", () => {
  it("restores a valid last selection and falls back when it is missing", async () => {
    window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, "second");
    const fetchMock = vi.fn(async () =>
      Response.json({ conversations: [first, second] } satisfies ConversationListResponse),
    );
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountConversations();

    await mounted.conversations.loadConversations();
    expect(mounted.conversations.activeConversationId.value).toBe("second");
    expect(window.localStorage.getItem(ACTIVE_CONVERSATION_KEY)).toBe("second");

    mounted.conversations.setActiveConversation("gone");
    await mounted.conversations.loadConversations();
    expect(mounted.conversations.activeConversationId.value).toBe("first");
    mounted.wrapper.unmount();
  });

  it("adds the first server-created conversation and updates its automatic title", async () => {
    const title: ConversationSummary = {
      ...first,
      title: "自动标题",
      titleSource: "auto",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("auto-title")) {
        return Response.json(title);
      }
      return Response.json({ conversations: [] } satisfies ConversationListResponse);
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountConversations();

    mounted.conversations.ensureConversation(first.id);
    await mounted.conversations.requestAutomaticTitle(first.id, "turn-1");
    expect(mounted.conversations.conversations.value).toMatchObject([
      { id: "first", title: "自动标题" },
    ]);
    expect(window.localStorage.getItem(ACTIVE_CONVERSATION_KEY)).toBe("first");
    mounted.wrapper.unmount();
  });

  it("removes the active conversation and returns the next fallback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/second")) {
        return new Response(null, { status: 204 });
      }
      return Response.json({ conversations: [first, second] } satisfies ConversationListResponse);
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountConversations();
    await mounted.conversations.loadConversations();
    mounted.conversations.setActiveConversation("second");

    const next = await mounted.conversations.deleteConversation("second");
    expect(next).toBe("first");
    expect(mounted.conversations.activeConversationId.value).toBe("first");
    expect(mounted.conversations.conversations.value).toEqual([first]);
    mounted.wrapper.unmount();
  });
});
