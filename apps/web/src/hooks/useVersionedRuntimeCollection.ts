import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

interface VersionedRuntimeCollectionReaders {
  getIds: () => readonly string[];
  getVersion: () => number;
}

export function useVersionedRuntimeCollectionIds({ getIds, getVersion }: VersionedRuntimeCollectionReaders) {
  const [ids, setIds] = useState<string[]>(() => [...getIds()]);
  const versionRef = useRef(getVersion());

  useFrame(() => {
    const nextVersion = getVersion();
    if (nextVersion === versionRef.current) {
      return;
    }

    versionRef.current = nextVersion;
    setIds([...getIds()]);
  });

  return ids;
}
