import { describe, expect, it } from "vitest";
import {
  clearTransientRuntimeInputFlags,
  createEmptyRuntimeInputCommand,
  packRuntimeInputCommand,
  unpackRuntimeInputCommand
} from "./runtimeInput";

describe("web runtimeInput re-export", () => {
  it("re-exports the shared netcode helpers", () => {
    const packed = packRuntimeInputCommand(createEmptyRuntimeInputCommand());
    const unpacked = unpackRuntimeInputCommand(packed);

    expect(unpacked.seq).toBe(0);
    expect(clearTransientRuntimeInputFlags(unpacked).typedText).toBe("");
  });
});
