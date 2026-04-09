import { z } from "zod";

export const chunkSizeSchema = z.int().positive();

export const blockKindSchema = z.enum(["ground", "boundary", "hazard", "water"]);

export type BlockKind = z.infer<typeof blockKindSchema>;

export const mapPropKindSchema = z.enum(["tree-oak"]);

export type MapPropKind = z.infer<typeof mapPropKindSchema>;
export type OccupiedKind = BlockKind | MapPropKind;

export interface Vec3i {
  x: number;
  y: number;
  z: number;
}

export const vec3iSchema = z.object({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
  z: z.int().nonnegative()
});

export const mapMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  theme: z.string().default("party-grass"),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type MapMeta = z.infer<typeof mapMetaSchema>;

export const spawnPointSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number()
});

export type MapSpawnPoint = z.infer<typeof spawnPointSchema>;

export const mapPropSchema = z.object({
  id: z.string().min(1),
  kind: mapPropKindSchema,
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
  z: z.int().nonnegative()
});

export type MapProp = z.infer<typeof mapPropSchema>;

export const voxelCellSchema = z.object({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
  z: z.int().nonnegative(),
  kind: blockKindSchema
});

export type VoxelCell = z.infer<typeof voxelCellSchema>;

export const mapDocumentSchema = z.object({
  version: z.literal(1),
  meta: mapMetaSchema,
  size: vec3iSchema.refine((size) => size.y > 0, {
    message: "size.y must be greater than zero"
  }),
  boundary: z.object({
    fallY: z.number()
  }),
  spawns: z.array(spawnPointSchema),
  props: z.array(mapPropSchema).default([]),
  voxels: z.array(voxelCellSchema)
});

export type MapDocumentV1 = z.infer<typeof mapDocumentSchema>;

export interface DetachedVoxelComponent {
  voxels: VoxelCell[];
}

export interface ChunkCoords {
  x: number;
  y: number;
  z: number;
}

export type ExposedFaceMask = number;

export interface VisibleVoxelInstance {
  key: string;
  position: Vec3i;
  kind: BlockKind;
  faceMask: ExposedFaceMask;
}

export interface VisibleVoxelChunk {
  key: string;
  coords: ChunkCoords;
  voxels: VisibleVoxelInstance[];
}

export type DirtyChunkSet = Set<string>;
