import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supportState = vi.hoisted(() => ({
  open: vi.fn(),
  triggerClassName: null as string | null,
}));

vi.mock("@cossistant/react", () => ({
  Support: ({
    classNames,
  }: {
    classNames?: {
      trigger?: string;
    };
  }) => {
    supportState.triggerClassName = classNames?.trigger ?? null;
    return <div data-testid="support-widget" />;
  },
  useSupport: () => ({
    open: supportState.open,
  }),
}));

vi.mock("./App", () => ({
  App: ({
    onOpenSupportWidget,
  }: {
    onOpenSupportWidget?: () => void;
  }) => (
    <button onClick={onOpenSupportWidget} type="button">
      Feedback / bug
    </button>
  ),
}));

import { SupportApp } from "./SupportApp";

describe("SupportApp", () => {
  beforeEach(() => {
    supportState.open.mockReset();
    supportState.triggerClassName = null;
  });

  it("opens support from the menu button and hides the default launcher", () => {
    render(<SupportApp />);

    fireEvent.click(screen.getByRole("button", { name: "Feedback / bug" }));

    expect(screen.getByTestId("support-widget")).toBeInTheDocument();
    expect(supportState.open).toHaveBeenCalledTimes(1);
    expect(supportState.triggerClassName).toBe("support-launcher-anchor");
  });
});
