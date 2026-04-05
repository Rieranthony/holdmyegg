import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

if (!("matchMedia" in window)) {
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
      dispatchEvent: vi.fn()
    }))
  });
}

if (!("pointerLockElement" in document)) {
  let pointerLockElement: Element | null = null;

  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get() {
      return pointerLockElement;
    }
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "requestPointerLock", {
    configurable: true,
    value() {
      pointerLockElement = this;
      document.dispatchEvent(new Event("pointerlockchange"));
    }
  });

  Object.defineProperty(document, "exitPointerLock", {
    configurable: true,
    value() {
      pointerLockElement = null;
      document.dispatchEvent(new Event("pointerlockchange"));
    }
  });
}
