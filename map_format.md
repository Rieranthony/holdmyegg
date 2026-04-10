# Map Format

## Canonical Format
`MapDocumentV1`

## Structure
- `version`
- `meta`
- `size`
- `boundary`
- `spawns`
- `props`
- `waterfalls`
- `voxels`

## Rules
- Coordinates are integer voxel coordinates
- `y` is the vertical axis
- Air is implicit and not stored
- Saved solid props store reusable object anchors such as trees
- Waterfalls store reusable animated scenery anchors
- Voxels store only non-air cells
- Chunking is derived at runtime with a default chunk size of `16`
- Visual texture selection is derived client-side from block kind and prop kind and is not stored in the document
- Decorative flora and spawn nests are derived client-side and are not stored in the document

## Save / Load
- Local saves use IndexedDB
- Export/import uses the exact same JSON document
- All loaded documents must pass Zod validation
