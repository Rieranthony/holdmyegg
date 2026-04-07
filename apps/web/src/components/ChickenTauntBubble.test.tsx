import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChickenTauntBubble } from "./ChickenTauntBubble";

describe("ChickenTauntBubble", () => {
  it("stays hidden when there is no message", () => {
    const { container } = render(<ChickenTauntBubble message={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the active taunt bubble", () => {
    render(<ChickenTauntBubble message="Hold my egg." />);

    expect(screen.getByText("Hold my egg.")).toBeInTheDocument();
  });

  it("replaces the current line instead of stacking a second bubble", () => {
    const { rerender } = render(<ChickenTauntBubble message="First warning." />);

    rerender(<ChickenTauntBubble message="Second warning." />);

    expect(screen.queryByText("First warning.")).not.toBeInTheDocument();
    expect(screen.getByText("Second warning.")).toBeInTheDocument();
    expect(screen.getAllByText("Second warning.")).toHaveLength(1);
  });
});
