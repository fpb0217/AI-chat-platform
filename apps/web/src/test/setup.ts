import { vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: vi.fn(async () => undefined) },
});

vi.stubGlobal(
  "requestAnimationFrame",
  (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
);
vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

class ResizeObserverStub {
  public constructor(_callback: ResizeObserverCallback) {}

  public observe(): void {}

  public unobserve(): void {}

  public disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
