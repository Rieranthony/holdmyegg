import { openDB } from "idb";
import type { MapDocumentV1 } from "@out-of-bounds/map";

const DATABASE_NAME = "out-of-bounds";
const STORE_NAME = "maps";

export interface SavedMapRecord {
  id: string;
  name: string;
  updatedAt: string;
  document: MapDocumentV1;
}

export interface SavedMapSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface MapStorageOptions {
  databaseName?: string;
  storeName?: string;
}

export const createMapStorage = ({
  databaseName = DATABASE_NAME,
  storeName = STORE_NAME
}: MapStorageOptions = {}) => {
  const databasePromise = openDB(databaseName, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, {
          keyPath: "id"
        });
      }
    }
  });

  return {
    async listSavedMaps(): Promise<SavedMapSummary[]> {
      const database = await databasePromise;
      const records = (await database.getAll(storeName)) as SavedMapRecord[];
      return records
        .map((record) => ({
          id: record.id,
          name: record.name,
          updatedAt: record.updatedAt
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async loadSavedMap(id: string) {
      const database = await databasePromise;
      return (await database.get(storeName, id)) as SavedMapRecord | undefined;
    },

    async saveMap(document: MapDocumentV1, id?: string) {
      const database = await databasePromise;
      const record: SavedMapRecord = {
        id: id ?? `map-${Date.now()}`,
        name: document.meta.name,
        updatedAt: new Date().toISOString(),
        document
      };

      await database.put(storeName, record);
      return record.id;
    },

    async deleteSavedMap(id: string) {
      const database = await databasePromise;
      await database.delete(storeName, id);
    }
  };
};

const defaultMapStorage = createMapStorage();

export const listSavedMaps = defaultMapStorage.listSavedMaps;
export const loadSavedMap = defaultMapStorage.loadSavedMap;
export const saveMap = defaultMapStorage.saveMap;
export const deleteSavedMap = defaultMapStorage.deleteSavedMap;
