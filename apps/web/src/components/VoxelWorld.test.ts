import { describe, expect, it } from "vitest";
import { drainDirtyChunkBuildQueue, enqueueDirtyChunkKeys } from "./VoxelWorld";

describe("VoxelWorld dirty chunk queue", () => {
  it("dedupes dirty keys and leaves overflow queued for later frames", () => {
    const pendingKeys = enqueueDirtyChunkKeys(new Set<string>(), ["chunk-a", "chunk-b", "chunk-a", "chunk-c"]);
    const rebuiltKeys: string[] = [];
    const disposedKeys: string[] = [];

    const result = drainDirtyChunkBuildQueue({
      currentByKey: new Map([
        ["chunk-a", "A"],
        ["chunk-b", "B"]
      ]),
      pendingKeys,
      rebuildChunk: (key) => {
        rebuiltKeys.push(key);
        return key.toUpperCase();
      },
      disposeChunk: (chunk) => {
        disposedKeys.push(chunk);
      },
      maxChunkCount: 2,
      maxRebuildMs: 100,
      getNow: () => 0
    });

    expect(result.processedKeys).toEqual(["chunk-a", "chunk-b"]);
    expect([...result.remainingKeys]).toEqual(["chunk-c"]);
    expect(rebuiltKeys).toEqual(["chunk-a", "chunk-b"]);
    expect(disposedKeys).toEqual(["A", "B"]);
    expect(result.nextByKey.get("chunk-a")).toBe("CHUNK-A");
    expect(result.nextByKey.get("chunk-b")).toBe("CHUNK-B");
  });

  it("stops draining once the frame budget is spent", () => {
    const timestamps = [0, 4, 4];
    const getNow = () => timestamps.shift() ?? 4;

    const result = drainDirtyChunkBuildQueue({
      currentByKey: new Map<string, string>(),
      pendingKeys: ["chunk-a", "chunk-b"],
      rebuildChunk: (key) => key.toUpperCase(),
      disposeChunk: () => {},
      maxChunkCount: 4,
      maxRebuildMs: 3,
      getNow
    });

    expect(result.processedKeys).toEqual(["chunk-a"]);
    expect([...result.remainingKeys]).toEqual(["chunk-b"]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(4);
  });
});
