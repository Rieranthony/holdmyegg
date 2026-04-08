import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("facehash", () => ({
  Facehash: ({
    name,
    size,
    className
  }: {
    className?: string;
    name: string;
    size: number;
  }) => (
    <div
      className={className}
      data-name={name}
      data-size={size}
      data-testid="facehash"
    />
  )
}));

import { PlayerAvatar } from "./PlayerAvatar";

describe("PlayerAvatar", () => {
  it("renders a saved profile image when one is available", () => {
    render(
      <PlayerAvatar
        imageUrl="https://example.com/avatar.png"
        label="Anthony"
        seed="seed-1"
      />
    );

    expect(screen.getByRole("img", { name: "Anthony" })).toHaveAttribute(
      "src",
      "https://example.com/avatar.png"
    );
  });

  it("falls back to the FaceHash avatar when there is no custom image", () => {
    render(
      <PlayerAvatar
        label="Anthony"
        seed="seed-1"
        size={48}
      />
    );

    expect(screen.getByTestId("facehash")).toHaveAttribute("data-name", "seed-1");
    expect(screen.getByTestId("facehash")).toHaveAttribute("data-size", "48");
  });
});
