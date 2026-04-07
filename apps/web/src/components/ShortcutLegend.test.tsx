import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getPauseShortcutBindings, getRuntimeShortcutBindings, ShortcutLegend } from "./ShortcutLegend";

describe("ShortcutLegend", () => {
  it("omits the pause shortcut from the pause overlay bindings", () => {
    const bindings = getPauseShortcutBindings();

    expect(bindings.some((binding) => binding.action === "Pause")).toBe(false);
  });

  it("renders pause bindings with concise pause detail copy", () => {
    render(
      <ShortcutLegend
        bindings={[
          {
            action: "Build",
            detail: "tap F to place a block",
            pauseDetail: "place a block",
            keys: ["F"]
          }
        ]}
        variant="pause"
      />
    );

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("place a block")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
  });

  it("describes harvest as click-based in the runtime bindings", () => {
    const binding = getRuntimeShortcutBindings().find((entry) => entry.action === "Harvest");

    expect(binding).toMatchObject({
      detail: "click to eat terrain for matter",
      keys: ["Click"]
    });
  });
});
