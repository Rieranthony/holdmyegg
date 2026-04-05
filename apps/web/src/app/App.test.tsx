import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultArenaMap, serializeMapDocument } from "@out-of-bounds/map";

const storageState = vi.hoisted(() => {
  const records = new Map<
    string,
    {
      id: string;
      name: string;
      updatedAt: string;
      document: ReturnType<typeof createDefaultArenaMap>;
    }
  >();

  return {
    records,
    reset() {
      records.clear();
    }
  };
});

vi.mock("../components/GameCanvas", () => ({
  GameCanvas: ({ mode, onReturnToMenu }: { mode: string; onReturnToMenu?: () => void }) => (
    <div>
      <div data-testid="game-canvas">{mode}</div>
      {onReturnToMenu ? (
        <button
          onClick={onReturnToMenu}
          type="button"
        >
          Mock Menu
        </button>
      ) : null}
    </div>
  )
}));

vi.mock("../data/mapStorage", () => ({
  listSavedMaps: vi.fn(async () =>
    [...storageState.records.values()]
      .map(({ id, name, updatedAt }) => ({
        id,
        name,
        updatedAt
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  ),
  loadSavedMap: vi.fn(async (id: string) => storageState.records.get(id)),
  saveMap: vi.fn(async (document: ReturnType<typeof createDefaultArenaMap>, id?: string) => {
    const nextId = id ?? `map-${storageState.records.size + 1}`;
    storageState.records.set(nextId, {
      id: nextId,
      name: document.meta.name,
      updatedAt: new Date().toISOString(),
      document
    });
    return nextId;
  }),
  deleteSavedMap: vi.fn(async (id: string) => {
    storageState.records.delete(id);
  })
}));

import { App } from "./App";

const APP_FLOW_TIMEOUT = 60_000;
const createTinyArenaDocument = (name: string) => ({
  version: 1 as const,
  meta: {
    name,
    description: "Tiny import fixture.",
    theme: "party-grass",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z"
  },
  size: { x: 8, y: 8, z: 8 },
  boundary: { fallY: -1 },
  spawns: [{ id: "spawn-1", x: 2.5, y: 1.05, z: 2.5 }],
  props: [],
  voxels: [{ x: 2, y: 0, z: 2, kind: "ground" as const }]
});

describe("App", () => {
  beforeEach(() => {
    storageState.reset();
    vi.useRealTimers();
    vi.stubGlobal("open", vi.fn());
  });

  it("renders the start menu by default", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Out of Bounds" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Knock rivals out of the arena, harvest cubes for Mass, and reshape the map before they do the same to you."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skirmish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map Workshop" })).toBeInTheDocument();
    expect(screen.queryByTestId("game-canvas")).not.toBeInTheDocument();
  });

  it(
    "opens the editor from the menu",
    async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Map Workshop" }));
    expect(screen.getByRole("heading", { name: "Map Workshop" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Default Arena")).toBeInTheDocument();
    expect(screen.getByTestId("game-canvas")).toHaveTextContent("editor");

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Select a save" })).toBeInTheDocument();
    });
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "switches runtime modes into the play view and returns to the menu",
    async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(await screen.findByText("Mass")).toBeInTheDocument();
    expect(screen.getByText("MASS FLOW")).toBeInTheDocument();
    expect(screen.getByText("Feathers")).toBeInTheDocument();
    expect(screen.getByText("24 / 300")).toBeInTheDocument();
    expect(
      screen.getByText("Look `Mouse`, move `W/S`, strafe `A/D`, jump `Space`, jetpack `Space` again and hold, harvest `LMB`, build `E`, egg `Q`, push `F`, pause `Esc`.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock Menu" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock Menu" }));
    expect(screen.getByRole("button", { name: "Skirmish" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skirmish" }));
    expect(await screen.findByText("NPC 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock Menu" }));
    expect(screen.getByRole("button", { name: "Map Workshop" })).toBeInTheDocument();
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "saves, loads, and deletes maps through the control panel",
    async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Map Workshop" }));

    const importFile = new File(
      [serializeMapDocument(createTinyArenaDocument("Imported Arena"))],
      "imported-arena.json",
      {
        type: "application/json"
      }
    );
    fireEvent.change(screen.getByLabelText("Import JSON"), {
      target: {
        files: [importFile]
      }
    });
    await waitFor(
      () => {
        expect(screen.getByLabelText("Name")).toHaveValue("Imported Arena");
      },
      { timeout: 10_000 }
    );

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Arena Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(
      () => {
        expect(screen.getByRole("option", { name: "Arena Alpha" })).toBeInTheDocument();
      },
      { timeout: 10_000 }
    );

    fireEvent.change(nameInput, { target: { value: "Arena Beta" } });
    expect(screen.getByLabelText("Name")).toHaveValue("Arena Beta");

    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Arena Alpha");
    }, { timeout: 20_000 });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: "Arena Alpha" })).not.toBeInTheDocument();
    }, { timeout: 10_000 });
    },
    APP_FLOW_TIMEOUT
  );

  it(
    "exports maps and handles valid and invalid imports cleanly",
    async () => {
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-map");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Map Workshop" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:test-map");

    const validDocument = createTinyArenaDocument("Imported Arena");
    const validFile = new File([serializeMapDocument(validDocument)], "imported-arena.json", {
      type: "application/json"
    });

    fireEvent.change(screen.getByLabelText("Import JSON"), {
      target: {
        files: [validFile]
      }
    });
    await waitFor(
      () => {
        expect(screen.getByLabelText("Name")).toHaveValue("Imported Arena");
      },
      { timeout: 10_000 }
    );
    expect(await screen.findByText('Imported "Imported Arena".')).toBeInTheDocument();

    const invalidFile = new File(['{"bad":true}'], "broken-map.json", {
      type: "application/json"
    });
    fireEvent.change(screen.getByLabelText("Import JSON"), {
      target: {
        files: [invalidFile]
      }
    });

    await waitFor(
      () => {
        expect(screen.getByText(/Import failed\. Check that the JSON is a valid Out of Bounds map\./)).toBeInTheDocument();
      },
      { timeout: 10_000 }
    );
    },
    APP_FLOW_TIMEOUT
  );
});
