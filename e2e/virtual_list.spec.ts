import { expect, test } from "@playwright/test";

test("virtualizes a 500-message conversation while preserving ordering", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");

  const longConversation = page
    .locator(".conversation-item")
    .filter({ hasText: "长会话测试" });
  await expect(longConversation).toBeVisible();
  await longConversation.locator(".conversation-select").click();

  const scrollArea = page.locator(".conversation-scroll");
  await expect(scrollArea).toHaveAttribute("data-message-count", "500");
  await expect
    .poll(() => scrollArea.locator(".message-row").count())
    .toBeLessThanOrEqual(30);
  await expect(page.getByRole("main")).toContainText("长会话消息 500");
  await expect(scrollArea.locator(".message-row").last()).toHaveAttribute(
    "aria-setsize",
    "500",
  );

  await scrollArea.dispatchEvent("wheel", { deltaY: -120 });
  await scrollArea.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByRole("main")).toContainText("长会话问题 1");
  await expect
    .poll(() => scrollArea.locator(".message-row").count())
    .toBeLessThanOrEqual(30);

  await scrollArea.evaluate((element) => {
    element.scrollTop = Math.round(
      (element.scrollHeight - element.clientHeight) / 2,
    );
  });
  await expect
    .poll(() => scrollArea.locator(".message-row").count())
    .toBeLessThanOrEqual(30);
  await expect(scrollArea.locator(".virtual-message-row").first()).toBeVisible();

  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole("main")).toContainText("长会话消息 500");
});

test("browses and jumps through the query scroll navigator", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto("/");

  const longConversation = page
    .locator(".conversation-item")
    .filter({ hasText: "长会话测试" });
  await longConversation.locator(".conversation-select").click();

  const scrollArea = page.locator(".conversation-scroll");
  const navigator = page.locator("[data-query-navigator]");
  await expect(navigator).toBeVisible();
  await expect(navigator.locator("[data-query-center-marker]")).toBeVisible();

  await scrollArea.dispatchEvent("wheel", { deltaY: -120 });
  await scrollArea.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByRole("main")).toContainText("长会话问题 1");
  await expect(
    navigator.locator('[aria-current="location"]'),
  ).toHaveAttribute("data-query-index", "0");
  await expect(
    navigator.locator('[aria-current="location"]'),
  ).toHaveAttribute("data-query-slot", "2");
  await expect(navigator.locator("[data-query-visible-index]")).toHaveCount(3);

  await navigator.hover();
  await page.mouse.wheel(0, 10);
  await expect(navigator.locator("[data-query-rail]")).toHaveAttribute(
    "data-query-rail-offset",
    "-4",
  );
  await page.mouse.wheel(0, 30);
  await expect(
    navigator.locator('[aria-current="location"]'),
  ).toHaveAttribute("data-query-index", "1");
  await expect(page.locator("[data-query-preview]")).toContainText(
    "长会话问题 2",
  );

  for (let step = 0; step < 4; step += 1) {
    await page.mouse.wheel(0, 80);
  }
  await expect(
    navigator.locator("[data-query-visible-index]").first(),
  ).toHaveAttribute("data-query-index", "3");

  const target = navigator.locator('[data-query-index="5"]');
  await target.hover();
  await expect(page.locator("[data-query-preview]")).toContainText(
    "长会话问题 6",
  );
  await target.click();

  await expect(page.getByRole("main")).toContainText("长会话问题 6");
  await expect(
    navigator.locator('[aria-current="location"]'),
  ).toHaveAttribute("data-query-index", "5");
});
