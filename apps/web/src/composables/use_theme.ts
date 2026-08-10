import { ref, type Ref } from "vue";

export const THEME_PREFERENCE_KEY = "ai-chat.theme.v1";
export const LIGHT_THEME: Theme = "light";
export const DARK_THEME: Theme = "dark";

export type Theme = "light" | "dark";

export interface UseThemeResult {
  theme: Ref<Theme>;
  setTheme: (nextTheme: Theme) => void;
  toggleTheme: () => void;
}

export function isTheme(value: unknown): value is Theme {
  return value === LIGHT_THEME || value === DARK_THEME;
}

export function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_PREFERENCE_KEY);
    return isTheme(stored) ? stored : LIGHT_THEME;
  } catch {
    return LIGHT_THEME;
  }
}

export function themeColor(theme: Theme): string {
  return theme === DARK_THEME ? "#101016" : "#f7f7fb";
}

export function syncThemeDom(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", themeColor(theme));
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_KEY, theme);
  } catch {
    // A blocked storage API must not prevent the current page from switching.
  }
}

export function useTheme(): UseThemeResult {
  const theme = ref<Theme>(readStoredTheme());

  function setTheme(nextTheme: Theme): void {
    if (!isTheme(nextTheme)) {
      return;
    }
    theme.value = nextTheme;
    syncThemeDom(nextTheme);
    persistTheme(nextTheme);
  }

  function toggleTheme(): void {
    setTheme(theme.value === LIGHT_THEME ? DARK_THEME : LIGHT_THEME);
  }

  // Apply the same value that index.html applies before Vue mounts.
  syncThemeDom(theme.value);

  return { theme, setTheme, toggleTheme };
}
