import { parseMapDocument, serializeMapDocument, type MapDocumentV1 } from "@out-of-bounds/map";

export const readFileText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The selected file could not be read as text."));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("The selected file could not be read."));
    };

    reader.readAsText(file);
  });

export const exportMapDocument = (mapDocument: MapDocumentV1, mapName: string) => {
  const payload = serializeMapDocument(mapDocument);
  const blob = new Blob([payload], {
    type: "application/json"
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${(mapName || "arena").toLowerCase().replace(/\s+/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(href);
};

export const importMapDocument = async (file: File) => parseMapDocument(await readFileText(file));
