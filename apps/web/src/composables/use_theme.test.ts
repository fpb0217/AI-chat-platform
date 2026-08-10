import { defineComponent, h, type ComponentPublicInstance } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DARK_THEME,
  LIGHT_THEME,
  THEME_PREFERENCE_KEY,
  useTheme,
} from "./use_theme";

type ThemeController = ReturnType<typeof useTheme>;

function mountTheme(): {
  theme: ThemeController;
  wrapper: VueWrapper<ComponentPublicInstance>;
} {
  let theme: ThemeController | undefined;
  const component = defineComponent({
    setup() {
      theme = useTheme();
      return () => h("div");
    },
  });
  const wrapper = mount(component);
  if (!theme) {
    throw new Error("Theme composable did not initialize");
  }
  return { theme, wrapper };
}

function appendThemeColorMeta(): HTMLMetaElement {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = "#f7f7fb";
  document.head.append(meta);
  return meta;
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.head.querySelector('meta[name="theme-color"]')?.remove();
  vi.restoreAllMocks();
});

describe("useTheme", () => {
  it("defaults to light even when the operating system prefers dark", () => {
    const matchMedia = vi.spyOn(window, "matchMedia");
    matchMedia.mockReturnValue({ matches: true } as MediaQueryList);

    const mounted = mountTheme();

    expect(mounted.theme.theme.value).toBe(LIGHT_THEME);
    expect(document.documentElement.dataset.theme).toBe(LIGHT_THEME);
    mounted.wrapper.unmount();
  });

  it("restores valid values and falls back for invalid values", () => {
    appendThemeColorMeta();
    window.localStorage.setItem(THEME_PREFERENCE_KEY, DARK_THEME);
    const mounted = mountTheme();

    expect(mounted.theme.theme.value).toBe(DARK_THEME);
    expect(document.documentElement.dataset.theme).toBe(DARK_THEME);
    expect(document.documentElement.style.colorScheme).toBe(DARK_THEME);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#101016",
    );
    mounted.wrapper.unmount();

    window.localStorage.setItem(THEME_PREFERENCE_KEY, "solar");
    const remounted = mountTheme();
    expect(remounted.theme.theme.value).toBe(LIGHT_THEME);
    expect(document.documentElement.dataset.theme).toBe(LIGHT_THEME);
    remounted.wrapper.unmount();
  });

  it("updates the DOM before attempting persistence and survives storage errors", () => {
    appendThemeColorMeta();
    const mounted = mountTheme();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });

    mounted.theme.toggleTheme();

    expect(mounted.theme.theme.value).toBe(DARK_THEME);
    expect(document.documentElement.dataset.theme).toBe(DARK_THEME);
    expect(document.documentElement.style.colorScheme).toBe(DARK_THEME);
    expect(setItem).toHaveBeenCalledWith(THEME_PREFERENCE_KEY, DARK_THEME);
    mounted.wrapper.unmount();
  });

  it("survives a storage read error and toggles in memory", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const mounted = mountTheme();

    expect(mounted.theme.theme.value).toBe(LIGHT_THEME);
    mounted.theme.setTheme(DARK_THEME);
    expect(mounted.theme.theme.value).toBe(DARK_THEME);
    expect(document.documentElement.dataset.theme).toBe(DARK_THEME);
    mounted.wrapper.unmount();
  });
});
