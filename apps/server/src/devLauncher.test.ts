import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prefixOutputChunk,
  runCombinedDevLauncher,
  type DevCommand,
  type DevLauncherDependencies,
  type DevProcess
} from "./devLauncher";

const encoder = new TextEncoder();

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve
  };
};

const createStreamPair = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    }
  });

  return {
    close() {
      controller.close();
    },
    push(text: string) {
      controller.enqueue(encoder.encode(text));
    },
    stream
  };
};

const createProcess = (
  exited: Promise<number>,
  options: {
    stderr?: ReadableStream<Uint8Array> | null;
    stdout?: ReadableStream<Uint8Array> | null;
  } = {}
) => {
  const kill = vi.fn();
  const process: DevProcess = {
    exited,
    kill,
    stderr: options.stderr ?? null,
    stdout: options.stdout ?? null
  };

  return {
    kill,
    process
  };
};

const commands: DevCommand[] = [
  {
    label: "server",
    cwd: "/repo",
    command: ["bun", "run", "--cwd", "apps/server", "dev"]
  },
  {
    label: "web",
    cwd: "/repo",
    command: ["bun", "run", "--cwd", "apps/web", "dev"]
  }
];

describe("dev launcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawns both dev processes and shuts them down on signal", async () => {
    const serverExit = createDeferred<number>();
    const webExit = createDeferred<number>();
    const server = createProcess(serverExit.promise);
    const web = createProcess(webExit.promise);
    const handlers = new Map<string, () => void>();
    const spawn = vi
      .fn<DevLauncherDependencies["spawn"]>()
      .mockReturnValueOnce(server.process)
      .mockReturnValueOnce(web.process);
    const write = vi.fn();
    const exit = vi.fn();

    const launcher = runCombinedDevLauncher(
      {
        exit,
        onSignal: vi.fn((signal, handler) => {
          handlers.set(signal, handler);
        }),
        spawn,
        write
      },
      commands
    );

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(1, commands[0]);
    expect(spawn).toHaveBeenNthCalledWith(2, commands[1]);

    handlers.get("SIGTERM")?.();

    serverExit.resolve(0);
    webExit.resolve(0);
    await launcher;
    expect(server.kill).toHaveBeenCalledWith("SIGTERM");
    expect(web.kill).toHaveBeenCalledWith("SIGTERM");
    expect(exit).toHaveBeenCalledWith(0);
    expect(write).not.toHaveBeenCalledWith(
      expect.stringContaining("exited unexpectedly")
    );
  });

  it("prefixes child process output lines", async () => {
    const serverExit = createDeferred<number>();
    const webExit = createDeferred<number>();
    const serverStdout = createStreamPair();
    const webStderr = createStreamPair();
    const server = createProcess(serverExit.promise, {
      stdout: serverStdout.stream
    });
    const web = createProcess(webExit.promise, {
      stderr: webStderr.stream
    });
    const handlers = new Map<string, () => void>();
    const writes: string[] = [];
    const exit = vi.fn();

    const launcher = runCombinedDevLauncher(
      {
        exit,
        onSignal(signal, handler) {
          handlers.set(signal, handler);
        },
        spawn: vi
          .fn<DevLauncherDependencies["spawn"]>()
          .mockReturnValueOnce(server.process)
          .mockReturnValueOnce(web.process),
        write(message) {
          writes.push(message);
        }
      },
      commands
    );

    serverStdout.push("ready\nstill");
    webStderr.push("warning!\n");
    await Promise.resolve();
    serverStdout.push(" going\n");
    serverStdout.close();
    webStderr.close();
    await Promise.resolve();

    handlers.get("SIGINT")?.();

    serverExit.resolve(0);
    webExit.resolve(0);
    await launcher;
    expect(exit).toHaveBeenCalledWith(0);
    expect(writes).toContain("[server] ready\n");
    expect(writes).toContain("[server] still going\n");
    expect(writes).toContain("[web] warning!\n");
  });

  it("exits non-zero and stops the other process when a child exits unexpectedly", async () => {
    const webExit = createDeferred<number>();
    const server = createProcess(Promise.resolve(0));
    const web = createProcess(webExit.promise);
    const exit = vi.fn();
    const write = vi.fn();

    await runCombinedDevLauncher(
      {
        exit,
        onSignal: vi.fn(),
        spawn: vi
          .fn<DevLauncherDependencies["spawn"]>()
          .mockReturnValueOnce(server.process)
          .mockReturnValueOnce(web.process),
        write
      },
      commands
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(web.kill).toHaveBeenCalledWith("SIGTERM");
    expect(write).toHaveBeenCalledWith(
      "[dev] server exited unexpectedly with code 0\n"
    );
  });

  it("tracks partial lines for prefixed output", () => {
    const state = {
      pending: ""
    };

    expect(prefixOutputChunk("server", "hello\nwor", state)).toEqual([
      "[server] hello\n"
    ]);
    expect(state.pending).toBe("wor");
    expect(prefixOutputChunk("server", "ld\n", state)).toEqual([
      "[server] world\n"
    ]);
    expect(state.pending).toBe("");
  });
});
