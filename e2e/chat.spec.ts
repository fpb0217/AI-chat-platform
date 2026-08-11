import { expect, test, type Page } from "@playwright/test";

const MIN_LIGHT_BUTTON_LUMINANCE = 0.45;

interface VisibleButtonSurface {
  backgroundColor: string;
  backgroundImage: string;
  className: string;
  label: string;
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * toLinear(red) +
    0.7152 * toLinear(green) +
    0.0722 * toLinear(blue)
  );
}

function buttonBackgroundLuminance(backgroundColor: string): number | null {
  const match = backgroundColor.match(
    /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?\)$/,
  );
  if (!match) {
    return null;
  }

  const [, red, green, blue, alpha = "1"] = match;
  if (Number(alpha) === 0) {
    return null;
  }

  return relativeLuminance(
    Number(red),
    Number(green),
    Number(blue),
  );
}

async function expectVisibleButtonsToUseLightSurfaces(page: Page): Promise<void> {
  const buttonSurfaces: VisibleButtonSurface[] = await page
    .locator("button")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const style = window.getComputedStyle(button);
          const bounds = button.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            bounds.width > 0 &&
            bounds.height > 0
          );
        })
        .map((button) => {
          const style = window.getComputedStyle(button);
          return {
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            className: button.className,
            label:
              button.getAttribute("aria-label") ??
              button.textContent?.replace(/\s+/g, " ").trim() ??
              "",
          };
        }),
    );

  const unsafeButtons = buttonSurfaces.filter((button) => {
    if (button.backgroundImage !== "none") {
      return true;
    }

    const luminance = buttonBackgroundLuminance(button.backgroundColor);
    return luminance !== null && luminance < MIN_LIGHT_BUTTON_LUMINANCE;
  });

  expect(unsafeButtons).toEqual([]);
}

test.describe.serial("local streaming chat", () => {
  test("shows a progressive answer and restores it after refresh", async ({
    page,
  }) => {
    await page.goto("/");
    const composer = page.getByLabel("输入消息");
    await composer.fill("请演示流式输出");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    const user = page.locator(".message-row-user").last();
    await expect(assistant).toContainText("这是一个");
    await expect(assistant).not.toContainText("逐字出现的流式回答。");
    await expect(assistant).toContainText("这是一个逐字出现的流式回答。");
    await expect(assistant.locator(".reasoning-panel")).toHaveCount(0);
    await expect(user.locator(".message-token-usage")).toContainText("实际输入 6");
    await expect(assistant.locator(".message-token-usage")).toContainText("正文 12");

    await page.reload();
    await expect(
      page.getByRole("main").getByText("请演示流式输出", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("这是一个逐字出现的流式回答。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".message-row-user").last().locator(".message-token-usage"),
    ).toContainText("实际输入 6");
    await expect(
      page.locator(".message-row-assistant").last().locator(".message-token-usage"),
    ).toContainText("正文 12");
  });

  test("uses max reasoning, reports its phase and restores its message label", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /推理强度：关闭/u })
      .click();
    await page.getByRole("option", { name: /最大/u }).click();
    await expect(
      page.getByRole("button", { name: /推理强度：最大/u }),
    ).toBeVisible();

    await page.getByLabel("输入消息").fill("请使用最大推理档位");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("正在深度思考", { exact: true })).toBeVisible();

    const assistant = page.locator(".message-row-assistant").last();
    const user = page.locator(".message-row-user").last();
    const reasoningToggle = assistant.getByRole("button", {
      name: /正在思考/u,
    });
    await expect(reasoningToggle).toHaveAttribute("aria-expanded", "true");
    await expect(assistant.getByRole("region")).toContainText("我会先分析问题");
    await expect(assistant).toContainText("最大推理");
    await expect(assistant).toContainText("这是一个逐字出现的流式回答。");
    await expect(user.locator(".message-token-usage")).toContainText("实际输入 6");
    await expect(assistant.locator(".message-token-usage")).toContainText("思考 5");
    await expect(assistant.locator(".message-token-usage")).toContainText("正文 7");
    const completedToggle = assistant.getByRole("button", {
      name: /已思考/u,
    });
    await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
    await completedToggle.click();
    await expect(assistant.getByRole("region")).toContainText(
      "我会先分析问题，再组织最终答案。",
    );

    await page.reload();
    const restored = page.locator(".message-row-assistant").last();
    await expect(restored).toContainText("最大推理");
    await expect(restored).toContainText("这是一个逐字出现的流式回答。");
    await expect(
      page.locator(".message-row-user").last().locator(".message-token-usage"),
    ).toContainText("实际输入 6");
    await expect(restored.locator(".message-token-usage")).toContainText("思考 5");
    await expect(restored.locator(".message-token-usage")).toContainText("正文 7");
    const restoredToggle = restored.getByRole("button", { name: /已思考/u });
    await expect(restoredToggle).toHaveAttribute("aria-expanded", "false");
    await restoredToggle.click();
    await expect(restored.getByRole("region")).toContainText(
      "我会先分析问题，再组织最终答案。",
    );
  });

  test("stops during reasoning and restores the partial thought", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /推理强度：关闭/u }).click();
    await page.getByRole("option", { name: /高/u }).click();
    await page.getByLabel("输入消息").fill("请给我一个慢思考");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant.getByRole("region")).toContainText(
      "我会先分析问题，再组织最终答案。",
    );
    await page.getByRole("button", { name: "停止生成" }).click();
    await expect(
      assistant.getByRole("button", { name: "思考已停止" }),
    ).toBeVisible();
    await expect(assistant).toContainText("已停止生成");
    await expect(assistant.locator(".message-token-usage")).toContainText("思考 —");
    await expect(assistant.locator(".message-token-usage")).toContainText("正文 —");
    await expect(
      page.locator(".message-row-user").last().locator(".message-token-usage"),
    ).toContainText("实际输入 —");

    await page.waitForTimeout(200);
    await page.reload();
    const restored = page.locator(".message-row-assistant").last();
    const restoredToggle = restored.getByRole("button", {
      name: "思考已停止",
    });
    await expect(restoredToggle).toHaveAttribute("aria-expanded", "false");
    await restoredToggle.click();
    await expect(restored.getByRole("region")).toContainText(
      "我会先分析问题，再组织最终答案。",
    );
  });

  test("keeps an overflowing reasoning panel pinned to its latest content", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto("/");
    await page.addStyleTag({
      content: ".reasoning-body { overflow-anchor: none !important; }",
    });
    await page.getByRole("button", { name: /推理强度：关闭/u }).click();
    await page.getByRole("option", { name: /高/u }).click();
    await page.getByLabel("输入消息").fill("请测试长思考滚动");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    const reasoningBody = assistant.locator(".reasoning-body");
    await expect(reasoningBody).toContainText("分析步骤 48");
    await expect
      .poll(() =>
        reasoningBody.evaluate((element) => ({
          overflowing: element.scrollHeight > element.clientHeight,
          bottomDistance:
            element.scrollHeight - element.scrollTop - element.clientHeight,
        })),
      )
      .toMatchObject({
        overflowing: true,
        bottomDistance: expect.any(Number),
      });
    await expect
      .poll(
        () =>
          reasoningBody.evaluate((element) =>
            Math.round(
              element.scrollHeight - element.scrollTop - element.clientHeight,
            ),
          ),
        { timeout: 1_500 },
      )
      .toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "停止生成" }).click();
  });

  test("keeps following when reasoning collapses before a long answer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1404, height: 451 });
    await page.goto("/");
    await page.getByRole("button", { name: /推理强度：关闭/u }).click();
    await page.getByRole("option", { name: /高/u }).click();
    await page.getByLabel("输入消息").fill("请测试代码块滚动");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    const reasoningToggle = assistant.getByRole("button", {
      name: /正在思考/u,
    });
    await expect(assistant.locator(".reasoning-body")).toContainText(
      "我会先分析问题，再组织最终答案。",
    );
    await expect(reasoningToggle).toHaveAttribute("aria-expanded", "true");

    await expect(assistant).toContainText("代码块生成完毕。", {
      timeout: 10_000,
    });
    await expect(
      assistant.getByRole("button", { name: /已思考/u }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        page.locator(".conversation-scroll").evaluate((element) =>
          Math.round(
            element.scrollHeight - element.scrollTop - element.clientHeight,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
  });

  test("stops generation and persists the partial answer", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("输入消息").fill("请给我一个慢回答");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant).toContainText("这是一段可以停止");
    await page.getByRole("button", { name: "停止生成" }).click();
    await expect(assistant).toContainText("已停止生成");

    await page.waitForTimeout(200);
    await page.reload();
    const restored = page.locator(".message-row-assistant").last();
    await expect(restored).toContainText("这是一段可以停止并保留的内容");
    await expect(restored).toContainText("已停止生成");
  });

  test("surfaces a normalized stream error without a retry control", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByLabel("输入消息").fill("触发错误");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByRole("alert")).toContainText("模型服务暂时不可用");
    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant).toContainText("已经收到部分内容。");
    await expect(assistant).toContainText("回答未完整生成");
    await expect(assistant.locator(".message-token-usage")).toContainText("正文 —");
    await expect(
      page.locator(".message-row-user").last().locator(".message-token-usage"),
    ).toContainText("实际输入 —");
    await expect(page.getByRole("button", { name: /重试/u })).toHaveCount(0);
  });

  test("keeps valid usage when a response finishes for length", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("输入消息").fill("请测试长度截断 Token");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant).toContainText("这是一个因长度限制而结束的回答。");
    await expect(assistant.locator(".message-token-usage")).toContainText("正文 12");
    await expect(
      page.locator(".message-row-user").last().locator(".message-token-usage"),
    ).toContainText("实际输入 6");
  });

  test("keeps the viewport pinned while a streamed code block grows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto("/");
    await page.getByLabel("输入消息").fill("请测试代码块滚动");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant.locator(".code-block")).toBeVisible();
    await expect(assistant).toContainText("代码块生成完毕。");

    await expect
      .poll(() =>
        page.locator(".conversation-scroll").evaluate((element) =>
          Math.round(
            element.scrollHeight - element.scrollTop - element.clientHeight,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
  });

  test("stops following immediately when the user scrolls up during streaming", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto("/");
    await page.getByLabel("输入消息").fill("请测试代码块滚动并保留阅读位置");
    await page.getByRole("button", { name: "发送消息" }).click();

    const scrollArea = page.locator(".conversation-scroll");
    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant.locator(".code-block")).toBeVisible();
    await expect
      .poll(() =>
        scrollArea.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      )
      .toBeGreaterThan(200);
    await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
    await expect(assistant).not.toContainText("代码块生成完毕。");

    await scrollArea.hover();
    await page.mouse.wheel(0, -160);

    await expect(page.getByRole("button", { name: "回到底部" })).toBeVisible();
    await expect(assistant).toContainText("代码块生成完毕。");
    await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
    await expect
      .poll(() =>
        scrollArea.evaluate(
          (element) =>
            element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
      )
      .toBeGreaterThan(96);
  });

  test("keeps the composer inside a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByLabel("输入消息")).toBeVisible();
    await expect(page.getByText("V4 Flash", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "切换到深色模式" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /推理强度：关闭/u }).click();
    await expect(page.getByRole("listbox", { name: "推理强度" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("switches themes with keyboard controls and restores the preference", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const themeToggle = page.getByRole("button", { name: "切换到深色模式" });
    await themeToggle.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("button", { name: "切换到浅色模式" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("ai-chat.theme.v1")),
      )
      .toBe("dark");
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const darkThemeToggle = page.getByRole("button", {
      name: "切换到浅色模式",
    });
    await darkThemeToggle.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.evaluate(() => {
      localStorage.setItem("ai-chat.theme.v1", "unsupported");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("applies the light palette to overlays and all visible buttons after switching back from dark", async ({
    page,
  }) => {
    await page.goto("/");

    const themeToggle = page.locator(".theme-toggle");
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.locator(".conversation-menu-trigger").first().click();
    const conversationMenu = page.locator(".conversation-menu");
    await expect(conversationMenu).toBeVisible();
    await expect(conversationMenu).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expectVisibleButtonsToUseLightSurfaces(page);

    await conversationMenu.getByRole("menuitem").first().click();
    const renameDialog = page.getByRole("dialog");
    await expect(renameDialog).toBeVisible();
    await expect(renameDialog).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expectVisibleButtonsToUseLightSurfaces(page);
  });

  test("creates two conversations and switches without mixing their messages", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".topbar-new-button").click();
    await page.getByLabel("输入消息").fill("会话一Z9Q");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("main")).toContainText("会话一Z9Q");
    await expect(page.getByRole("main")).toContainText(
      "这是一个逐字出现的流式回答。",
    );
    await expect(page.locator(".topbar-new-button")).toBeEnabled();

    await page.locator(".topbar-new-button").click();
    await expect(page.getByText("现在，想聊点什么？")).toBeVisible();
    await page.getByLabel("输入消息").fill("会话二Z9Q");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("main")).toContainText("会话二Z9Q");

    const firstConversation = page
      .locator(".conversation-item")
      .filter({ hasText: "会话一Z9Q" });
    await expect(firstConversation).toBeVisible();
    await firstConversation.locator(".conversation-select").click();
    await expect(page.getByRole("main")).toContainText("会话一Z9Q");
    await expect(page.getByRole("main")).not.toContainText("会话二Z9Q");
  });

  test("updates the sidebar title after each completed turn", async ({ page }) => {
    await page.goto("/");
    await page.locator(".topbar-new-button").click();

    const composer = page.getByLabel("输入消息");
    const activeConversation = page.locator(".conversation-item-active");
    const firstQuestion = "标题更新A1Z9Q";
    const secondQuestion = "标题更新A2Z9Q";

    await composer.fill(firstQuestion);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(activeConversation.locator(".conversation-title")).toHaveText(
      firstQuestion,
    );

    await composer.fill(secondQuestion);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(activeConversation.locator(".conversation-title")).toHaveText(
      secondQuestion,
    );
  });

  test("renames a conversation and requires a second click before deletion", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".topbar-new-button").click();
    await page.getByLabel("输入消息").fill("删会话Z9Q");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("main")).toContainText("删会话Z9Q");

    const conversation = page
      .locator(".conversation-item")
      .filter({ hasText: "删会话Z9Q" });
    await expect(conversation).toBeVisible();
    await conversation.getByRole("button", { name: /操作：删会话Z9Q/u }).click();
    await conversation.getByRole("menuitem", { name: "重命名" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const titleInput = page.getByLabel("会话标题");
    await titleInput.fill("手动Z9Q");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.locator(".conversation-item").filter({ hasText: "手动Z9Q" }),
    ).toBeVisible();

    const renamed = page
      .locator(".conversation-item")
      .filter({ hasText: "手动Z9Q" });
    await renamed.getByRole("button", { name: /操作：手动Z9Q/u }).click();
    await renamed.getByRole("menuitem", { name: "删除" }).click();
    await expect(renamed.getByRole("menuitem", { name: "确认删除" })).toBeVisible();
    await expect(renamed).toBeVisible();
    await renamed.getByRole("menuitem", { name: "确认删除" }).click();
    await expect(
      page.locator(".conversation-item").filter({ hasText: "手动Z9Q" }),
    ).toHaveCount(0);
  });
});
