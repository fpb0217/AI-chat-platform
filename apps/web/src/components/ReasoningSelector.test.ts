import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReasoningSelector from "./ReasoningSelector.vue";

describe("ReasoningSelector", () => {
  it("opens with the keyboard and emits the selected reasoning level", async () => {
    const wrapper = mount(ReasoningSelector, {
      props: {
        model: "deepseek-v4-flash",
        modelValue: "off",
        levels: ["off", "low", "high", "max"],
        disabled: false,
      },
      attachTo: document.body,
    });
    const trigger = wrapper.get('button[aria-haspopup="listbox"]');

    await trigger.trigger("keydown", { key: "ArrowDown" });
    const options = wrapper.findAll('[role="option"]');
    expect(options).toHaveLength(4);
    expect(document.activeElement).toBe(options[0]?.element);

    await options[3]?.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["max"]]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("does not open while generation disables the selector", async () => {
    const wrapper = mount(ReasoningSelector, {
      props: {
        model: "deepseek-v4-flash",
        modelValue: "high",
        levels: ["off", "low", "high", "max"],
        disabled: true,
      },
    });
    const trigger = wrapper.get('button[aria-haspopup="listbox"]');

    expect(trigger.attributes("disabled")).toBeDefined();
    await trigger.trigger("click");
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
