import { mapDocumentSchema } from "./types";
import { DEFAULT_FOUNDATION_DEPTH } from "./default-map";
import { getMapPropVoxels } from "./props";
import type {
  BlockKind,
  DetachedVoxelComponent,
  DirtyChunkSet,
  MapDocumentV1,
  MapProp,
  MapPropKind,
  MapSpawnPoint,
  OccupiedKind,
  Vec3i,
  VisibleVoxelChunk,
  VisibleVoxelInstance,
  VoxelCell,
  WaterfallFeature
} from "./types";
import {
  DEFAULT_CHUNK_SIZE,
  EXPOSED_FACE_BITS,
  chunkCoordsFromPosition,
  chunkKeyFromCoords,
  cloneMapDocument,
  collectDirtyChunkKeysAround,
  createVoxelKey,
  isInBounds,
  isBlockingBlockKind,
  isLiquidBlockKind,
  sortVoxels
} from "./utils";

const surfaceNeighbors = [
  [1, 0, 0, EXPOSED_FACE_BITS.posX],
  [-1, 0, 0, EXPOSED_FACE_BITS.negX],
  [0, 1, 0, EXPOSED_FACE_BITS.posY],
  [0, -1, 0, EXPOSED_FACE_BITS.negY],
  [0, 0, 1, EXPOSED_FACE_BITS.posZ],
  [0, 0, -1, EXPOSED_FACE_BITS.negZ]
] as const;

const surfaceMutationOffsets = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
] as const;

const sortVisibleVoxelInstances = (left: VisibleVoxelInstance, right: VisibleVoxelInstance) => {
  if (left.position.y !== right.position.y) {
    return left.position.y - right.position.y;
  }

  if (left.position.z !== right.position.z) {
    return left.position.z - right.position.z;
  }

  return left.position.x - right.position.x;
};

const sortWaterfalls = (left: WaterfallFeature, right: WaterfallFeature) => left.id.localeCompare(right.id);

const mergeDirtyChunkSets = (target: DirtyChunkSet, source: DirtyChunkSet) => {
  for (const key of source) {
    target.add(key);
  }
};

const sortDetachedComponents = (components: DetachedVoxelComponent[]) =>
  components.sort((left, right) => {
    const leftFirst = left.voxels[0]!;
    const rightFirst = right.voxels[0]!;
    if (leftFirst.y !== rightFirst.y) {
      return leftFirst.y - rightFirst.y;
    }

    if (leftFirst.z !== rightFirst.z) {
      return leftFirst.z - rightFirst.z;
    }

    return leftFirst.x - rightFirst.x;
  });

const componentTraversalOffsets = [
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0]
] as const;

interface PropVoxelEntry {
  propId: string;
  kind: MapPropKind;
}

export class MutableVoxelWorld {
  readonly size: Vec3i;
  readonly boundary: MapDocumentV1["boundary"];
  readonly meta: MapDocumentV1["meta"];

  private readonly voxelMap = new Map<string, VoxelCell>();
  private readonly spawnMap = new Map<string, MapSpawnPoint>();
  private readonly propMap = new Map<string, MapProp>();
  private readonly waterfallMap = new Map<string, WaterfallFeature>();
  private readonly propVoxelMap = new Map<string, PropVoxelEntry>();
  private readonly surfaceChunkMap = new Map<string, Map<string, VisibleVoxelInstance>>();
  private readonly topTerrainYByColumn: Int16Array;
  private readonly topGroundYByColumn: Int16Array;
  private readonly topSolidYByColumn: Int16Array;
  private readonly topWaterYByColumn: Int16Array;
  private terrainRevision = 0;

  constructor(document: MapDocumentV1) {
    const parsed = mapDocumentSchema.parse(document);
    this.size = { ...parsed.size };
    this.boundary = { ...parsed.boundary };
    this.meta = { ...parsed.meta };
    const columnCount = this.size.x * this.size.z;
    this.topTerrainYByColumn = new Int16Array(columnCount).fill(-1);
    this.topGroundYByColumn = new Int16Array(columnCount).fill(-1);
    this.topSolidYByColumn = new Int16Array(columnCount).fill(-1);
    this.topWaterYByColumn = new Int16Array(columnCount).fill(-1);

    for (const voxel of parsed.voxels) {
      this.voxelMap.set(createVoxelKey(voxel.x, voxel.y, voxel.z), { ...voxel });
    }

    for (const spawn of parsed.spawns) {
      this.spawnMap.set(spawn.id, { ...spawn });
    }

    for (const prop of parsed.props) {
      this.propMap.set(prop.id, { ...prop });
    }

    for (const waterfall of parsed.waterfalls) {
      this.waterfallMap.set(waterfall.id, { ...waterfall });
    }

    this.rebuildPropVoxelIndex();
    this.rebuildColumnHeightCache();
    this.rebuildSurfaceChunkIndex();
  }

  clone() {
    return new MutableVoxelWorld(this.toDocument());
  }

  getTerrainRevision() {
    return this.terrainRevision;
  }

  touchMeta() {
    this.meta.updatedAt = new Date().toISOString();
  }

  hasVoxel(x: number, y: number, z: number) {
    return this.voxelMap.has(createVoxelKey(x, y, z));
  }

  getVoxel(x: number, y: number, z: number) {
    return this.voxelMap.get(createVoxelKey(x, y, z));
  }

  getVoxelKind(x: number, y: number, z: number) {
    return this.getVoxel(x, y, z)?.kind;
  }

  hasOccupiedVoxel(x: number, y: number, z: number) {
    const key = createVoxelKey(x, y, z);
    return this.voxelMap.has(key) || this.propVoxelMap.has(key);
  }

  getOccupiedKind(x: number, y: number, z: number): OccupiedKind | undefined {
    return this.getVoxelKind(x, y, z) ?? this.propVoxelMap.get(createVoxelKey(x, y, z))?.kind;
  }

  hasWater(x: number, y: number, z: number) {
    return this.getVoxelKind(x, y, z) === "water";
  }

  hasBlockingVoxel(x: number, y: number, z: number) {
    const voxelKind = this.getVoxelKind(x, y, z);
    return isBlockingBlockKind(voxelKind) || this.propVoxelMap.has(createVoxelKey(x, y, z));
  }

  getBlockingKind(x: number, y: number, z: number) {
    const voxelKind = this.getVoxelKind(x, y, z);
    return isBlockingBlockKind(voxelKind)
      ? voxelKind
      : this.propVoxelMap.get(createVoxelKey(x, y, z))?.kind;
  }

  hasSolid(x: number, y: number, z: number) {
    return this.hasBlockingVoxel(x, y, z);
  }

  getSolidKind(x: number, y: number, z: number) {
    return this.getBlockingKind(x, y, z);
  }

  getTopTerrainY(x: number, z: number) {
    if (!this.isColumnInBounds(x, z)) {
      return -1;
    }

    return this.topTerrainYByColumn[this.getColumnIndex(x, z)] ?? -1;
  }

  getTopGroundY(x: number, z: number) {
    if (!this.isColumnInBounds(x, z)) {
      return -1;
    }

    return this.topGroundYByColumn[this.getColumnIndex(x, z)] ?? -1;
  }

  getTopSolidY(x: number, z: number) {
    if (!this.isColumnInBounds(x, z)) {
      return -1;
    }

    return this.topSolidYByColumn[this.getColumnIndex(x, z)] ?? -1;
  }

  getTopBlockingY(x: number, z: number) {
    return this.getTopSolidY(x, z);
  }

  getTopWaterY(x: number, z: number) {
    if (!this.isColumnInBounds(x, z)) {
      return -1;
    }

    return this.topWaterYByColumn[this.getColumnIndex(x, z)] ?? -1;
  }

  listSpawns() {
    return [...this.spawnMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  listProps() {
    return [...this.propMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  listWaterfalls() {
    return [...this.waterfallMap.values()].sort(sortWaterfalls);
  }

  nextSpawnId() {
    let maxIndex = 0;

    for (const id of this.spawnMap.keys()) {
      const match = /^spawn-(\d+)$/.exec(id);
      if (!match) {
        continue;
      }

      maxIndex = Math.max(maxIndex, Number(match[1]));
    }

    return `spawn-${maxIndex + 1}`;
  }

  nextPropId() {
    let maxIndex = 0;

    for (const id of this.propMap.keys()) {
      const match = /^prop-(\d+)$/.exec(id);
      if (!match) {
        continue;
      }

      maxIndex = Math.max(maxIndex, Number(match[1]));
    }

    return `prop-${maxIndex + 1}`;
  }

  nextWaterfallId() {
    let maxIndex = 0;

    for (const id of this.waterfallMap.keys()) {
      const match = /^waterfall-(\d+)$/.exec(id);
      if (!match) {
        continue;
      }

      maxIndex = Math.max(maxIndex, Number(match[1]));
    }

    return `waterfall-${maxIndex + 1}`;
  }

  getWaterfall(id: string) {
    return this.waterfallMap.get(id);
  }

  findWaterfallAtOrigin(x: number, y: number, z: number) {
    return this.listWaterfalls().find((waterfall) => waterfall.x === x && waterfall.y === y && waterfall.z === z);
  }

  setWaterfall(
    waterfall: Omit<WaterfallFeature, "id">,
    id = this.nextWaterfallId()
  ) {
    this.waterfallMap.set(id, {
      id,
      ...waterfall
    });
    this.touchMeta();
    return id;
  }

  removeWaterfall(id: string) {
    const deleted = this.waterfallMap.delete(id);
    if (deleted) {
      this.touchMeta();
    }

    return deleted;
  }

  setSpawn(x: number, y: number, z: number, id = this.nextSpawnId()) {
    this.spawnMap.set(id, { id, x, y, z });
    this.touchMeta();
    return id;
  }

  removeSpawn(id: string) {
    const deleted = this.spawnMap.delete(id);
    if (deleted) {
      this.touchMeta();
    }
    return deleted;
  }

  canPlaceProp(kind: MapPropKind, x: number, y: number, z: number, ignoreId?: string) {
    const prop = {
      id: ignoreId ?? "__candidate__",
      kind,
      x,
      y,
      z
    } satisfies MapProp;

    return getMapPropVoxels(prop).every((voxel) => {
      if (!isInBounds(this.size, voxel.x, voxel.y, voxel.z)) {
        return false;
      }

      const key = createVoxelKey(voxel.x, voxel.y, voxel.z);
      const existingPropVoxel = this.propVoxelMap.get(key);
      return !this.voxelMap.has(key) && (!existingPropVoxel || existingPropVoxel.propId === ignoreId);
    });
  }

  setProp(kind: MapPropKind, x: number, y: number, z: number, id = this.nextPropId()) {
    if (!this.canPlaceProp(kind, x, y, z, id)) {
      return null;
    }

    const existing = this.propMap.get(id);
    if (existing && existing.kind === kind && existing.x === x && existing.y === y && existing.z === z) {
      return id;
    }

    this.propMap.set(id, { id, kind, x, y, z });
    this.rebuildPropVoxelIndex();
    this.rebuildTopSolidHeightCache();
    this.touchMeta();
    return id;
  }

  removeProp(id: string) {
    const deleted = this.propMap.delete(id);
    if (deleted) {
      this.rebuildPropVoxelIndex();
      this.rebuildTopSolidHeightCache();
      this.touchMeta();
    }

    return deleted;
  }

  getPropAtVoxel(x: number, y: number, z: number) {
    const propId = this.propVoxelMap.get(createVoxelKey(x, y, z))?.propId;
    return propId ? this.propMap.get(propId) : undefined;
  }

  getEditablePropPlacement(kind: MapPropKind, x: number, z: number) {
    const clampedX = Math.min(this.size.x - 1, Math.max(0, x));
    const clampedZ = Math.min(this.size.z - 1, Math.max(0, z));
    const topGroundY = this.getTopGroundY(clampedX, clampedZ);

    if (topGroundY < 0) {
      return null;
    }

    const placement = {
      x: clampedX,
      y: topGroundY + 1,
      z: clampedZ
    };

    if (!this.canPlaceProp(kind, placement.x, placement.y, placement.z)) {
      return null;
    }

    return placement;
  }

  pruneUnsupportedPropsAtColumns(
    columns?: Iterable<Pick<Vec3i, "x" | "z">>,
    protectedPropIds?: ReadonlySet<string>
  ) {
    const touchedColumns = columns
      ? new Set<number>()
      : null;

    if (columns && touchedColumns) {
      for (const column of columns) {
        if (!this.isColumnInBounds(column.x, column.z)) {
          continue;
        }

        touchedColumns.add(this.getColumnIndex(column.x, column.z));
      }

      if (touchedColumns.size === 0) {
        return [] as MapProp[];
      }
    }

    const removedProps: MapProp[] = [];

    for (const prop of this.listProps()) {
      if (touchedColumns && !touchedColumns.has(this.getColumnIndex(prop.x, prop.z))) {
        continue;
      }

      if (protectedPropIds?.has(prop.id)) {
        continue;
      }

      if (isBlockingBlockKind(this.getVoxelKind(prop.x, prop.y - 1, prop.z))) {
        continue;
      }

      this.propMap.delete(prop.id);
      removedProps.push(prop);
    }

    if (removedProps.length === 0) {
      return removedProps;
    }

    this.rebuildPropVoxelIndex();
    this.rebuildTopSolidHeightCache();
    this.touchMeta();
    return removedProps;
  }

  setVoxel(x: number, y: number, z: number, kind: BlockKind, chunkSize = DEFAULT_CHUNK_SIZE): DirtyChunkSet {
    return this.setVoxels([{ x, y, z, kind }], chunkSize);
  }

  removeVoxel(x: number, y: number, z: number, chunkSize = DEFAULT_CHUNK_SIZE): DirtyChunkSet {
    return this.removeVoxels([{ x, y, z }], chunkSize);
  }

  setVoxels(cells: Iterable<VoxelCell>, chunkSize = DEFAULT_CHUNK_SIZE): DirtyChunkSet {
    const pending = new Map<string, VoxelCell>();
    for (const cell of cells) {
      if (!isInBounds(this.size, cell.x, cell.y, cell.z)) {
        continue;
      }

      pending.set(createVoxelKey(cell.x, cell.y, cell.z), {
        x: cell.x,
        y: cell.y,
        z: cell.z,
        kind: cell.kind
      });
    }

    if (pending.size === 0) {
      return new Set();
    }

    const dirtyChunkKeys: DirtyChunkSet = new Set();
    const touchedColumns = new Set<number>();
    const surfaceSyncKeys = new Set<string>();
    let changed = false;

    for (const cell of pending.values()) {
      const existing = this.voxelMap.get(createVoxelKey(cell.x, cell.y, cell.z));
      if (existing?.kind === cell.kind) {
        continue;
      }

      this.voxelMap.set(createVoxelKey(cell.x, cell.y, cell.z), cell);
      mergeDirtyChunkSets(dirtyChunkKeys, collectDirtyChunkKeysAround(this.size, cell.x, cell.y, cell.z, chunkSize));
      touchedColumns.add(this.getColumnIndex(cell.x, cell.z));
      this.collectSurfaceSyncKeys(surfaceSyncKeys, cell.x, cell.y, cell.z);
      changed = true;
    }

    if (!changed) {
      return dirtyChunkKeys;
    }

    this.commitTerrainMutationBatch(surfaceSyncKeys, touchedColumns);
    return dirtyChunkKeys;
  }

  removeVoxels(cells: Iterable<Pick<VoxelCell, "x" | "y" | "z">>, chunkSize = DEFAULT_CHUNK_SIZE): DirtyChunkSet {
    const pending = new Map<string, Pick<VoxelCell, "x" | "y" | "z">>();
    for (const cell of cells) {
      if (!isInBounds(this.size, cell.x, cell.y, cell.z)) {
        continue;
      }

      pending.set(createVoxelKey(cell.x, cell.y, cell.z), {
        x: cell.x,
        y: cell.y,
        z: cell.z
      });
    }

    if (pending.size === 0) {
      return new Set();
    }

    const dirtyChunkKeys: DirtyChunkSet = new Set();
    const touchedColumns = new Set<number>();
    const surfaceSyncKeys = new Set<string>();
    let changed = false;

    for (const cell of pending.values()) {
      const deleted = this.voxelMap.delete(createVoxelKey(cell.x, cell.y, cell.z));
      if (!deleted) {
        continue;
      }

      mergeDirtyChunkSets(dirtyChunkKeys, collectDirtyChunkKeysAround(this.size, cell.x, cell.y, cell.z, chunkSize));
      touchedColumns.add(this.getColumnIndex(cell.x, cell.z));
      this.collectSurfaceSyncKeys(surfaceSyncKeys, cell.x, cell.y, cell.z);
      changed = true;
    }

    if (!changed) {
      return dirtyChunkKeys;
    }

    this.commitTerrainMutationBatch(surfaceSyncKeys, touchedColumns);
    return dirtyChunkKeys;
  }

  getEditableSpawnPosition(x: number, z: number) {
    const clampedX = Math.min(this.size.x - 1, Math.max(0, x));
    const clampedZ = Math.min(this.size.z - 1, Math.max(0, z));
    return {
      x: clampedX + 0.5,
      y: this.getTopTerrainY(clampedX, clampedZ) + 1.05,
      z: clampedZ + 0.5
    };
  }

  isSurfaceVoxel(x: number, y: number, z: number) {
    return this.getExposedFaceMask(x, y, z) !== 0;
  }

  buildVisibleChunks(chunkSize = DEFAULT_CHUNK_SIZE) {
    if (chunkSize !== DEFAULT_CHUNK_SIZE) {
      return this.scanVisibleChunks(chunkSize);
    }

    return [...this.surfaceChunkMap.entries()]
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entries]) => this.createChunkFromEntries(key, entries.values(), chunkSize));
  }

  buildVisibleChunkByKey(targetKey: string, chunkSize = DEFAULT_CHUNK_SIZE) {
    if (chunkSize !== DEFAULT_CHUNK_SIZE) {
      return this.scanVisibleChunkByKey(targetKey, chunkSize);
    }

    const entries = this.surfaceChunkMap.get(targetKey);
    if (!entries || entries.size === 0) {
      return null;
    }

    return this.createChunkFromEntries(targetKey, entries.values(), chunkSize);
  }

  buildVisibleChunksForKeys(keys: Iterable<string>, chunkSize = DEFAULT_CHUNK_SIZE) {
    return [...keys]
      .map((key) => this.buildVisibleChunkByKey(key, chunkSize))
      .filter((chunk): chunk is VisibleVoxelChunk => chunk !== null);
  }

  collectDetachedComponents(): DetachedVoxelComponent[] {
    const anchored = new Set<string>();
    const anchorQueue: string[] = [];

    for (const voxel of this.voxelMap.values()) {
      if (!isBlockingBlockKind(voxel.kind)) {
        continue;
      }

      if (!this.isAnchorVoxel(voxel)) {
        continue;
      }

      const key = createVoxelKey(voxel.x, voxel.y, voxel.z);
      anchored.add(key);
      anchorQueue.push(key);
    }

    while (anchorQueue.length > 0) {
      const key = anchorQueue.pop()!;
      const position = this.parsePositionKey(key);

      for (const [ox, oy, oz] of surfaceNeighbors) {
        const neighborKey = createVoxelKey(position.x + ox, position.y + oy, position.z + oz);
        if (!this.hasBlockingTerrainVoxel(position.x + ox, position.y + oy, position.z + oz) || anchored.has(neighborKey)) {
          continue;
        }

        anchored.add(neighborKey);
        anchorQueue.push(neighborKey);
      }
    }

    const visited = new Set(anchored);
    const detached: DetachedVoxelComponent[] = [];

    for (const voxel of sortVoxels(this.voxelMap.values()).filter((entry) => isBlockingBlockKind(entry.kind))) {
      const startKey = createVoxelKey(voxel.x, voxel.y, voxel.z);
      if (visited.has(startKey)) {
        continue;
      }

      const componentQueue = [startKey];
      const component: VoxelCell[] = [];
      visited.add(startKey);

      while (componentQueue.length > 0) {
        const key = componentQueue.pop()!;
        const current = this.voxelMap.get(key);
        if (!current) {
          continue;
        }

        component.push({ ...current });
        for (const [ox, oy, oz] of surfaceNeighbors) {
          const neighborKey = createVoxelKey(current.x + ox, current.y + oy, current.z + oz);
          if (!this.hasBlockingTerrainVoxel(current.x + ox, current.y + oy, current.z + oz) || visited.has(neighborKey)) {
            continue;
          }

          visited.add(neighborKey);
          componentQueue.push(neighborKey);
        }
      }

      detached.push({
        voxels: sortVoxels(component)
      });
    }

    return sortDetachedComponents(detached);
  }

  collectDetachedComponentsNear(mutatedVoxels: Iterable<Pick<VoxelCell, "x" | "y" | "z">>): DetachedVoxelComponent[] {
    const seedKeys = new Set<string>();

    for (const voxel of mutatedVoxels) {
      for (const [ox, oy, oz] of surfaceNeighbors) {
        const neighborKey = createVoxelKey(voxel.x + ox, voxel.y + oy, voxel.z + oz);
        if (!this.hasBlockingTerrainVoxel(voxel.x + ox, voxel.y + oy, voxel.z + oz)) {
          continue;
        }

        seedKeys.add(neighborKey);
      }
    }

    if (seedKeys.size === 0) {
      return [];
    }

    const explored = new Set<string>();
    const detached: DetachedVoxelComponent[] = [];
    const sortedSeeds = [...seedKeys]
      .map((key) => this.parsePositionKey(key))
      .sort((left, right) => {
        if (left.y !== right.y) {
          return left.y - right.y;
        }

        if (left.z !== right.z) {
          return left.z - right.z;
        }

        return left.x - right.x;
      });

    for (const seed of sortedSeeds) {
      const seedKey = createVoxelKey(seed.x, seed.y, seed.z);
      if (explored.has(seedKey)) {
        continue;
      }

      const componentKeys = new Set<string>();
      const componentQueue = [seedKey];
      let anchored = false;

      while (componentQueue.length > 0) {
        const key = componentQueue.pop()!;
        if (componentKeys.has(key)) {
          continue;
        }

        const current = this.voxelMap.get(key);
        if (!current) {
          continue;
        }

        componentKeys.add(key);
        if (this.isAnchorVoxel(current)) {
          anchored = true;
          break;
        }

        for (let index = componentTraversalOffsets.length - 1; index >= 0; index -= 1) {
          const [ox, oy, oz] = componentTraversalOffsets[index]!;
          const neighborKey = createVoxelKey(current.x + ox, current.y + oy, current.z + oz);
          if (!this.hasBlockingTerrainVoxel(current.x + ox, current.y + oy, current.z + oz) || componentKeys.has(neighborKey)) {
            continue;
          }

          componentQueue.push(neighborKey);
        }
      }

      for (const key of componentKeys) {
        explored.add(key);
      }

      if (!anchored) {
        detached.push({
          voxels: sortVoxels(
            [...componentKeys]
              .map((key) => this.voxelMap.get(key))
              .filter((voxel): voxel is VoxelCell => voxel !== undefined)
          )
        });
      }
    }

    return sortDetachedComponents(detached);
  }

  getComponentDropDistance(voxels: Iterable<Pick<VoxelCell, "x" | "y" | "z">>) {
    const cells = [...voxels];
    if (cells.length === 0) {
      return 0;
    }

    const ownKeys = new Set(cells.map((voxel) => createVoxelKey(voxel.x, voxel.y, voxel.z)));
    let dropDistance = 0;

    while (true) {
      const nextDrop = dropDistance + 1;
      for (const voxel of cells) {
        const nextY = voxel.y - nextDrop;
        if (nextY < 0) {
          return dropDistance;
        }

        const key = createVoxelKey(voxel.x, nextY, voxel.z);
        if (this.hasBlockingTerrainVoxel(voxel.x, nextY, voxel.z) && !ownKeys.has(key)) {
          return dropDistance;
        }
      }

      dropDistance = nextDrop;
    }
  }

  settleDetachedComponents(chunkSize = DEFAULT_CHUNK_SIZE) {
    const detached = this.collectDetachedComponents();
    const dirtyChunkKeys: DirtyChunkSet = new Set();
    if (detached.length === 0) {
      return {
        components: [] as DetachedVoxelComponent[],
        dirtyChunkKeys
      };
    }

    mergeDirtyChunkSets(
      dirtyChunkKeys,
      this.removeVoxels(detached.flatMap((component) => component.voxels), chunkSize)
    );

    const settledComponents = detached
      .slice()
      .sort((left, right) => {
        const leftMinY = Math.min(...left.voxels.map((voxel) => voxel.y));
        const rightMinY = Math.min(...right.voxels.map((voxel) => voxel.y));
        return leftMinY - rightMinY;
      })
      .map((component) => {
        const dropDistance = this.getComponentDropDistance(component.voxels);
        const settled = {
          voxels: component.voxels.map((voxel) => ({
            ...voxel,
            y: voxel.y - dropDistance
          }))
        };

        mergeDirtyChunkSets(dirtyChunkKeys, this.setVoxels(settled.voxels, chunkSize));

        return settled;
      });

    return {
      components: settledComponents,
      dirtyChunkKeys
    };
  }

  toDocument(): MapDocumentV1 {
    return cloneMapDocument({
      version: 1,
      meta: { ...this.meta },
      size: { ...this.size },
      boundary: { ...this.boundary },
      spawns: this.listSpawns(),
      props: this.listProps(),
      waterfalls: this.listWaterfalls(),
      voxels: sortVoxels(this.voxelMap.values())
    });
  }

  private rebuildPropVoxelIndex() {
    this.propVoxelMap.clear();

    for (const prop of this.propMap.values()) {
      for (const voxel of getMapPropVoxels(prop)) {
        this.propVoxelMap.set(createVoxelKey(voxel.x, voxel.y, voxel.z), {
          propId: prop.id,
          kind: prop.kind
        });
      }
    }
  }

  private rebuildColumnHeightCache() {
    for (let x = 0; x < this.size.x; x += 1) {
      for (let z = 0; z < this.size.z; z += 1) {
        this.rebuildColumnHeightEntry(x, z);
      }
    }
  }

  private rebuildTopSolidHeightCache() {
    for (let x = 0; x < this.size.x; x += 1) {
      for (let z = 0; z < this.size.z; z += 1) {
        const columnIndex = this.getColumnIndex(x, z);
        this.topSolidYByColumn[columnIndex] = this.findTopSolidY(x, z);
        this.topWaterYByColumn[columnIndex] = this.findTopWaterY(x, z);
      }
    }
  }

  private rebuildColumnHeightEntry(x: number, z: number) {
    if (!this.isColumnInBounds(x, z)) {
      return;
    }

    const columnIndex = this.getColumnIndex(x, z);
    this.topTerrainYByColumn[columnIndex] = this.findTopTerrainY(x, z);
    this.topGroundYByColumn[columnIndex] = this.findTopGroundY(x, z);
    this.topSolidYByColumn[columnIndex] = this.findTopSolidY(x, z);
    this.topWaterYByColumn[columnIndex] = this.findTopWaterY(x, z);
  }

  private findTopTerrainY(x: number, z: number) {
    for (let y = this.size.y - 1; y >= 0; y -= 1) {
      if (this.hasVoxel(x, y, z)) {
        return y;
      }
    }

    return -1;
  }

  private findTopGroundY(x: number, z: number) {
    for (let y = this.size.y - 1; y >= 0; y -= 1) {
      if (this.getVoxelKind(x, y, z) === "ground") {
        return y;
      }
    }

    return -1;
  }

  private findTopSolidY(x: number, z: number) {
    for (let y = this.size.y - 1; y >= 0; y -= 1) {
      if (this.hasBlockingVoxel(x, y, z)) {
        return y;
      }
    }

    return -1;
  }

  private findTopWaterY(x: number, z: number) {
    for (let y = this.size.y - 1; y >= 0; y -= 1) {
      if (this.getVoxelKind(x, y, z) === "water") {
        return y;
      }
    }

    return -1;
  }

  private rebuildSurfaceChunkIndex() {
    this.surfaceChunkMap.clear();

    for (const voxel of this.voxelMap.values()) {
      const faceMask = this.getExposedFaceMask(voxel.x, voxel.y, voxel.z);
      if (faceMask === 0) {
        continue;
      }

      this.setSurfaceChunkEntry(voxel, faceMask);
    }
  }

  private syncSurfaceChunkIndexAround(x: number, y: number, z: number) {
    for (const [ox, oy, oz] of surfaceMutationOffsets) {
      this.syncSurfaceChunkEntry(x + ox, y + oy, z + oz);
    }
  }

  private collectSurfaceSyncKeys(target: Set<string>, x: number, y: number, z: number) {
    for (const [ox, oy, oz] of surfaceMutationOffsets) {
      target.add(createVoxelKey(x + ox, y + oy, z + oz));
    }
  }

  private commitTerrainMutationBatch(surfaceSyncKeys: Set<string>, touchedColumns: Set<number>) {
    for (const columnIndex of touchedColumns) {
      this.rebuildColumnHeightEntry(columnIndex % this.size.x, Math.floor(columnIndex / this.size.x));
    }

    for (const key of surfaceSyncKeys) {
      const position = this.parsePositionKey(key);
      this.syncSurfaceChunkEntry(position.x, position.y, position.z);
    }

    this.terrainRevision += 1;
    this.touchMeta();
  }

  private syncSurfaceChunkEntry(x: number, y: number, z: number) {
    const voxel = this.getVoxel(x, y, z);
    const faceMask = this.getExposedFaceMask(x, y, z);
    if (!voxel || faceMask === 0) {
      this.removeSurfaceChunkEntry(x, y, z);
      return;
    }

    this.setSurfaceChunkEntry(voxel, faceMask);
  }

  private setSurfaceChunkEntry(voxel: VoxelCell, faceMask: number) {
    const chunkKey = chunkKeyFromCoords(chunkCoordsFromPosition(voxel.x, voxel.y, voxel.z, DEFAULT_CHUNK_SIZE));
    const entries = this.surfaceChunkMap.get(chunkKey) ?? new Map<string, VisibleVoxelInstance>();
    entries.set(createVoxelKey(voxel.x, voxel.y, voxel.z), this.createVisibleVoxelInstance(voxel, faceMask));
    this.surfaceChunkMap.set(chunkKey, entries);
  }

  private removeSurfaceChunkEntry(x: number, y: number, z: number) {
    const chunkKey = chunkKeyFromCoords(chunkCoordsFromPosition(x, y, z, DEFAULT_CHUNK_SIZE));
    const entries = this.surfaceChunkMap.get(chunkKey);
    if (!entries) {
      return;
    }

    entries.delete(createVoxelKey(x, y, z));
    if (entries.size === 0) {
      this.surfaceChunkMap.delete(chunkKey);
    }
  }

  private createVisibleVoxelInstance(voxel: VoxelCell, faceMask = this.getExposedFaceMask(voxel.x, voxel.y, voxel.z)): VisibleVoxelInstance {
    const topGroundY = voxel.kind === "ground" ? this.getTopGroundY(voxel.x, voxel.z) : -1;

    return {
      key: createVoxelKey(voxel.x, voxel.y, voxel.z),
      position: {
        x: voxel.x,
        y: voxel.y,
        z: voxel.z
      },
      kind: voxel.kind,
      faceMask,
      surfaceDepth: topGroundY >= voxel.y ? topGroundY - voxel.y : 0
    };
  }

  private getExposedFaceMask(x: number, y: number, z: number) {
    const voxel = this.getVoxel(x, y, z);
    if (!voxel) {
      return 0;
    }

    let faceMask = 0;
    for (const [ox, oy, oz, bit] of surfaceNeighbors) {
      const neighborKind = this.getVoxelKind(x + ox, y + oy, z + oz);
      if (!neighborKind) {
        faceMask |= bit;
        continue;
      }

      if (isLiquidBlockKind(voxel.kind)) {
        if (!isLiquidBlockKind(neighborKind)) {
          faceMask |= bit;
        }
        continue;
      }

      if (isLiquidBlockKind(neighborKind)) {
        faceMask |= bit;
      }
    }

    return faceMask;
  }

  private createChunkFromEntries(
    targetKey: string,
    entries: Iterable<VisibleVoxelInstance>,
    chunkSize = DEFAULT_CHUNK_SIZE
  ): VisibleVoxelChunk {
    const voxels = [...entries].sort(sortVisibleVoxelInstances);
    const [first] = voxels;
    const coords = chunkCoordsFromPosition(first.position.x, first.position.y, first.position.z, chunkSize);

    return {
      key: targetKey,
      coords,
      voxels
    };
  }

  private scanVisibleChunks(chunkSize = DEFAULT_CHUNK_SIZE) {
    const chunkMap = new Map<string, VisibleVoxelChunk>();

    for (const voxel of this.voxelMap.values()) {
      if (!this.isSurfaceVoxel(voxel.x, voxel.y, voxel.z)) {
        continue;
      }

      const coords = chunkCoordsFromPosition(voxel.x, voxel.y, voxel.z, chunkSize);
      const chunkKey = chunkKeyFromCoords(coords);
      const existing =
        chunkMap.get(chunkKey) ??
        {
          key: chunkKey,
          coords,
          voxels: []
        };

      existing.voxels.push(this.createVisibleVoxelInstance(voxel));
      chunkMap.set(chunkKey, existing);
    }

    return [...chunkMap.values()].sort((left, right) => left.key.localeCompare(right.key));
  }

  private scanVisibleChunkByKey(targetKey: string, chunkSize = DEFAULT_CHUNK_SIZE) {
    const chunk: VisibleVoxelChunk | null = null;
    const voxels: VisibleVoxelInstance[] = [];

    for (const voxel of this.voxelMap.values()) {
      const coords = chunkCoordsFromPosition(voxel.x, voxel.y, voxel.z, chunkSize);
      const chunkKey = chunkKeyFromCoords(coords);
      if (chunkKey !== targetKey || !this.isSurfaceVoxel(voxel.x, voxel.y, voxel.z)) {
        continue;
      }

      voxels.push(this.createVisibleVoxelInstance(voxel));
    }

    if (voxels.length === 0) {
      return chunk;
    }

    return this.createChunkFromEntries(targetKey, voxels, chunkSize);
  }

  private isAnchorVoxel(voxel: VoxelCell) {
    return isBlockingBlockKind(voxel.kind) && (
      voxel.y < DEFAULT_FOUNDATION_DEPTH ||
      voxel.x === 0 ||
      voxel.z === 0 ||
      voxel.x === this.size.x - 1 ||
      voxel.z === this.size.z - 1
    );
  }

  private hasBlockingTerrainVoxel(x: number, y: number, z: number) {
    return isBlockingBlockKind(this.getVoxelKind(x, y, z));
  }

  private isColumnInBounds(x: number, z: number) {
    return x >= 0 && x < this.size.x && z >= 0 && z < this.size.z;
  }

  private getColumnIndex(x: number, z: number) {
    return z * this.size.x + x;
  }

  private parsePositionKey(key: string) {
    const [x, y, z] = key.split(",").map(Number);
    return { x, y, z };
  }
}
