import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ThemeToggle from "./ThemeToggle.vue";

describe("ThemeToggle", () => {
  it("shows the light-mode control and emits when clicked", async () => {
    const wrapper = mount(ThemeToggle, {
      props: { theme: "light" },
    });
    const button = wrapper.get("button");

    expect(button.attributes("aria-label")).toBe("切换到深色模式");
    expect(button.attributes("title")).toBe("切换到深色模式");
    expect(button.attributes("aria-pressed")).toBe("false");
    expect(wrapper.find("svg").exists()).toBe(true);

    await button.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("updates its accessible name and icon in dark mode", () => {
    const wrapper = mount(ThemeToggle, {
      props: { theme: "dark" },
    });

    const button = wrapper.get("button");
    expect(button.attributes("aria-label")).toBe("切换到浅色模式");
    expect(button.attributes("title")).toBe("切换到浅色模式");
    expect(button.attributes("aria-pressed")).toBe("true");
  });
});
