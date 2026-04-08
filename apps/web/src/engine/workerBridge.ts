import type {
  WorkerRequestMessage,
  WorkerResponseMessage
} from "./protocol";

export interface GameWorkerLike {
  onmessage: ((event: MessageEvent<WorkerResponseMessage>) => void) | null;
  postMessage: (
    message: WorkerRequestMessage,
    transfer?: Transferable[]
  ) => void;
  terminate: () => void;
}

export type GameWorkerFactory = () => GameWorkerLike;

export const createLocalGameWorker = (): GameWorkerLike =>
  new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module"
  }) as unknown as GameWorkerLike;
