import { createDefaultArenaMap, type MapDocumentV1 } from "@out-of-bounds/map";

export interface PlaylistMap {
  id: string;
  document: MapDocumentV1;
}

const createNamedArena = (id: string, name: string, description: string): PlaylistMap => {
  const document = createDefaultArenaMap();
  document.meta.name = name;
  document.meta.description = description;
  document.meta.updatedAt = new Date().toISOString();
  return {
    id,
    document
  };
};

export const createWarmPlaylistMaps = () => [
  createNamedArena("warm-map-1", "Foundry Run", "The core public arena rotation."),
  createNamedArena("warm-map-2", "Skyline Scramble", "A high-visibility public arena rotation."),
  createNamedArena("warm-map-3", "Gravel Crown", "A chunky mid-pack public arena rotation."),
  createNamedArena("warm-map-4", "Melt Pit", "A frantic public arena rotation.")
];
