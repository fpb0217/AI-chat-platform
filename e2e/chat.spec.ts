import { expect, test } from "@playwright/test";

test.describe.serial("local streaming chat", () => {
  test("shows a progressive answer and restores it after refresh", async ({
    page,
  }) => {
    await page.goto("/");
    const composer = page.getByLabel("输入消息");
    await composer.fill("请演示流式输出");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistant = page.locator(".message-row-assistant").last();
    await expect(assistant).toContainText("这是一个");
    await expect(assistant).not.toContainText("逐字出现的流式回答。");
    await expect(assistant).toContainText("这是一个逐字出现的流式回答。");

    await page.reload();
    await expect(page.getByText("请演示流式输出", { exact: true })).toBeVisible();
    await expect(
      page.getByText("这是一个逐字出现的流式回答。", { exact: true }),
    ).toBeVisible();
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
    await expect(page.getByRole("button", { name: /重试/u })).toHaveCount(0);
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

  test("keeps the composer inside a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByLabel("输入消息")).toBeVisible();
    await expect(page.getByText("V4 Flash", { exact: true })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
