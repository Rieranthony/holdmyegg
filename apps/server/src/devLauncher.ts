type DevSignal = "SIGINT" | "SIGTERM";

export interface DevCommand {
  label: string;
  cwd: string;
  command: string[];
}

export interface DevProcess {
  exited: Promise<number>;
  kill(signal?: DevSignal): void;
  stderr?: ReadableStream<Uint8Array> | null;
  stdout?: ReadableStream<Uint8Array> | null;
}

export interface DevLauncherDependencies {
  exit(code: number): never | void;
  onSignal(signal: DevSignal, handler: () => void): void;
  spawn(command: DevCommand): DevProcess;
  write(message: string): void;
}

const ROOT_CWD = process.cwd();

export const DEV_COMMANDS: DevCommand[] = [
  {
    label: "server",
    cwd: ROOT_CWD,
    command: ["bun", "run", "--cwd", "apps/server", "dev"]
  },
  {
    label: "web",
    cwd: ROOT_CWD,
    command: ["bun", "run", "--cwd", "apps/web", "dev"]
  }
];

export interface PrefixState {
  pending: string;
}

export const prefixOutputChunk = (
  label: string,
  chunk: string,
  state: PrefixState
) => {
  const lines = `${state.pending}${chunk}`.split(/\r?\n/);
  state.pending = lines.pop() ?? "";
  return lines.map((line) => `[${label}] ${line}\n`);
};

const flushPrefixedOutput = (label: string, state: PrefixState) => {
  if (!state.pending) {
    return [];
  }

  const trailing = [`[${label}] ${state.pending}\n`];
  state.pending = "";
  return trailing;
};

const pumpPrefixedStream = (
  stream: ReadableStream<Uint8Array> | null | undefined,
  label: string,
  write: (message: string) => void
) => {
  if (!stream) {
    return Promise.resolve();
  }

  const state: PrefixState = {
    pending: ""
  };
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  return (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        const chunk = decoder.decode(result.value, {
          stream: true
        });
        for (const line of prefixOutputChunk(label, chunk, state)) {
          write(line);
        }
      }

      const finalChunk = decoder.decode();
      if (finalChunk) {
        for (const line of prefixOutputChunk(label, finalChunk, state)) {
          write(line);
        }
      }

      for (const line of flushPrefixedOutput(label, state)) {
        write(line);
      }
    } finally {
      reader.releaseLock();
    }
  })();
};

const resolveUnexpectedExitCode = (code: number) => (code === 0 ? 1 : code);

export const runCombinedDevLauncher = async (
  dependencies: DevLauncherDependencies,
  commands: DevCommand[] = DEV_COMMANDS
) => {
  const processes = commands.map((command) => ({
    command,
    process: dependencies.spawn(command)
  }));
  let shuttingDown = false;

  for (const { command, process } of processes) {
    void pumpPrefixedStream(process.stdout, command.label, dependencies.write);
    void pumpPrefixedStream(process.stderr, command.label, dependencies.write);
  }

  const stopAll = (signal: DevSignal) => {
    for (const { process } of processes) {
      process.kill(signal);
    }
  };

  const shutdown = (code: number, signal?: DevSignal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (signal) {
      stopAll(signal);
    }
    dependencies.exit(code);
  };

  dependencies.onSignal("SIGINT", () => {
    shutdown(0, "SIGINT");
  });
  dependencies.onSignal("SIGTERM", () => {
    shutdown(0, "SIGTERM");
  });

  const exitResult = await Promise.race(
    processes.map(async ({ command, process }) => ({
      code: await process.exited,
      label: command.label
    }))
  );

  if (!shuttingDown) {
    dependencies.write(
      `[dev] ${exitResult.label} exited unexpectedly with code ${exitResult.code}\n`
    );
    stopAll("SIGTERM");
    shutdown(resolveUnexpectedExitCode(exitResult.code));
  }
};

const createBunDependencies = (): DevLauncherDependencies => {
  const bunBinary = Bun.which("bun") ?? "bun";

  return {
    exit(code) {
      process.exit(code);
    },
    onSignal(signal, handler) {
      process.on(signal, handler);
    },
    spawn(command) {
      const child = Bun.spawn({
        cmd: [bunBinary, ...command.command.slice(1)],
        cwd: command.cwd,
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe"
      });

      return {
        exited: child.exited,
        kill(signal) {
          child.kill(signal);
        },
        stderr: child.stderr,
        stdout: child.stdout
      };
    },
    write(message) {
      process.stdout.write(message);
    }
  };
};

if (import.meta.main) {
  await runCombinedDevLauncher(createBunDependencies());
}
