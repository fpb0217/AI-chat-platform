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
