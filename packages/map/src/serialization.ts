import { mapDocumentSchema } from "./types";
import type { MapDocumentV1 } from "./types";

export const serializeMapDocument = (document: MapDocumentV1) => JSON.stringify(mapDocumentSchema.parse(document), null, 2);

export const parseMapDocument = (raw: string) => mapDocumentSchema.parse(JSON.parse(raw));

