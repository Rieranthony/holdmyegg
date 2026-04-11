import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createDefaultArenaMap, type MapDocumentV1 } from "@out-of-bounds/map";
import type { GameMode, HudState } from "@out-of-bounds/sim";
import {
  chickenRadioStations,
  getChickenRadioStation,
  normalizeChickenRadioSettings,
  type ChickenRadioPlaybackState,
  type ChickenRadioSettings,
} from "./chickenRadio";
import { ChickenRadioOverlay } from "../components/ChickenRadioOverlay";
import { ChickenRadioPlayerHost } from "../components/ChickenRadioPlayerHost";
import { ChickenPreview } from "../components/ChickenPreview";
import { Hud } from "../components/Hud";
import { MultiplayerRoomCards } from "../components/MultiplayerRoomCards";
import { MultiplayerRoomOverlay } from "../components/MultiplayerRoomOverlay";
import { RuntimeControlsSettings } from "../components/RuntimeControlsSettings";
import {
  getPauseShortcutBindings,
  ShortcutLegend,
  getRuntimeShortcutBindings,
} from "../components/ShortcutLegend";
import {
  loadChickenRadioSettings,
  saveChickenRadioSettings,
} from "../data/chickenRadioStorage";
import {
  loadRuntimeControlSettings,
  resetRuntimeControlSettings,
  saveRuntimeControlSettings,
} from "../data/runtimeControlSettingsStorage";
import { GameHost, type GameHostHandle } from "../engine/GameHost";
import {
  blockKindOptions,
  featureKindOptions,
  propKindOptions,
  waterfallDirectionOptions,
  type ActiveShellMode,
  type EditorPanelState,
  type GameDiagnostics,
  type PointerCaptureFailureReason,
  type PlayerProfile,
  type RuntimeCaptureMode,
  type RuntimePauseState,
  type ShellMode,
} from "../engine/types";
import { chickenPalettes } from "../game/colors";
import {
  createDefaultRuntimeControlSettings,
  normalizeRuntimeControlSettings,
  type RuntimeControlSettings,
} from "../game/runtimeControlSettings";
import {
  MultiplayerClient,
  type MultiplayerSnapshot,
} from "../multiplayer/client";
import { useRendererQualityProfile } from "../game/quality";
import {
  buildExplorePortalRuntimeConfig,
  buildPortalRedirectUrl,
  getCurrentGameUrl,
  readPortalBootstrapState,
} from "./portalSession";
import { useMapPersistence } from "./useMapPersistence";

const defaultStatus =
  "Type your name, choose a chicken color, and drop into the arena.";
const launchTimings = {
  dim: 250,
  stage: 400,
  drop: 350,
} as const;

type LaunchPhase = "dimming" | "staging" | "dropping";
type RulesOrigin = "menu" | "multiplayerMenu" | "pause";

interface LaunchState {
  mode: GameMode;
  phase: LaunchPhase;
}

const createDefaultEditorPanelState = (
  document: MapDocumentV1,
): EditorPanelState => ({
  mapName: document.meta.name,
  tool: "add",
  blockKind: "ground",
  propKind: "tree-oak",
  featureKind: "waterfall",
  featureDirection: "west",
});

const createDefaultPauseState = (): RuntimePauseState => ({
  hasStarted: false,
  paused: false,
  pointerLocked: false,
  pointerCapturePending: false,
  pointerCaptureFailureReason: null,
});

const getPointerCaptureFailureMessage = (
  reason: PointerCaptureFailureReason,
) => {
  switch (reason) {
    case "unsupported":
      return "This browser could not capture the mouse. Try a different browser or head back to the menu.";
    case "error":
      return "Mouse capture was blocked. Click Capture Mouse to try again.";
    case "timeout":
      return "Mouse capture took too long. You are safe here. Click Capture Mouse to retry.";
    case "focus-lost":
      return "Mouse capture was interrupted when the window lost focus. Click Capture Mouse when you are back in the game.";
  }
};

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : normalized;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const getModeStatusMessage = (mode: ActiveShellMode) => {
  if (mode === "editor") {
    return "Editor ready.";
  }

  if (mode === "multiplayer") {
    return "Multiplayer room ready.";
  }

  return mode === "explore"
    ? "Explore mode ready."
    : "PLAY NPC mode ready. Outlast the flock.";
};

const getModeLabel = (mode: ActiveShellMode) => {
  if (mode === "editor") {
    return "WORKSHOP";
  }

  if (mode === "multiplayer") {
    return "MULTIPLAYER";
  }

  return mode === "explore" ? "EXPLORE" : "PLAY NPC";
};

const getRuntimeControlsSummary = (
  settings: RuntimeControlSettings,
) => {
  const directionSummary: string[] = [];

  if (settings.invertLookX) {
    directionSummary.push("Invert X");
  }
  if (settings.invertLookY) {
    directionSummary.push("Invert Y");
  }

  return `${settings.lookSensitivity.toFixed(1)}x · ${
    directionSummary.length > 0
      ? directionSummary.join(" · ")
      : "Standard"
  }`;
};

const getMultiplayerIdentityTitle = (
  multiplayer: MultiplayerSnapshot,
  fallbackName: string,
) => {
  const savedDisplayName = multiplayer.profile?.displayName?.trim();
  if (savedDisplayName) {
    return savedDisplayName;
  }

  const localName = fallbackName.trim();
  return localName.length > 0 ? localName : "Anonymous mode";
};

const getMultiplayerIdentityDetail = (
  multiplayer: MultiplayerSnapshot,
  fallbackName: string,
) => {
  if (multiplayer.booting) {
    return "Restoring multiplayer";
  }

  if (multiplayer.authenticated) {
    return "Anonymous mode · scores saved";
  }

  if (multiplayer.available) {
    return fallbackName.trim().length > 0
      ? "Anonymous mode · ready to save scores"
      : "Anonymous mode · enter your name once";
  }

  return "Multiplayer offline";
};

interface AppProps {
  initialMode?: ShellMode;
  multiplayerClient?: Pick<
    MultiplayerClient,
    | "boot"
    | "createWorkerBridge"
    | "dispose"
    | "ensureReady"
    | "getSnapshot"
    | "joinRoom"
    | "leaveRoom"
    | "quickJoin"
    | "sendChat"
    | "subscribe"
  >;
  onOpenSupportWidget?: () => void;
}

export function App({
  initialMode = "menu",
  multiplayerClient: injectedMultiplayerClient,
  onOpenSupportWidget,
}: AppProps = {}) {
  const [portalBootstrap] = useState(() =>
    readPortalBootstrapState(
      typeof window === "undefined"
        ? null
        : {
            origin: window.location.origin,
            pathname: window.location.pathname,
            search: window.location.search,
          },
    ),
  );
  const initialShellMode = portalBootstrap ? "explore" : initialMode;
  const hostRef = useRef<GameHostHandle>(null);
  const launchTimersRef = useRef<number[]>([]);
  const menuLoadTokenRef = useRef(1);
  const pauseStateRef = useRef<RuntimePauseState>(createDefaultPauseState());
  const runtimeModeRef = useRef<GameMode>("explore");
  const [statusMessage, setStatusMessage] = useState(() =>
    initialShellMode === "editor"
      ? getModeStatusMessage("editor")
      : initialShellMode === "explore"
        ? getModeStatusMessage("explore")
        : defaultStatus,
  );
  const [mode, setMode] = useState<ShellMode>(initialShellMode);
  const [rulesOrigin, setRulesOrigin] = useState<RulesOrigin | null>(null);
  const [editorDocument, setEditorDocument] = useState<MapDocumentV1>(() =>
    createDefaultArenaMap(),
  );
  const [editorState, setEditorState] = useState<EditorPanelState>(() =>
    createDefaultEditorPanelState(createDefaultArenaMap()),
  );
  const [hudState, setHudState] = useState<HudState | null>(null);
  const [pauseState, setPauseState] = useState<RuntimePauseState>(
    () =>
      portalBootstrap
        ? {
            hasStarted: true,
            paused: false,
            pointerLocked: false,
            pointerCapturePending: false,
            pointerCaptureFailureReason: null,
          }
        : createDefaultPauseState(),
  );
  const [launchState, setLaunchState] = useState<LaunchState | null>(null);
  const [menuLoadToken, setMenuLoadToken] = useState(1);
  const [menuLoading, setMenuLoading] = useState(initialShellMode === "menu");
  const [menuControlsOpen, setMenuControlsOpen] = useState(false);
  const [matchColorSeed, setMatchColorSeed] = useState(0);
  const [diagnostics, setDiagnostics] = useState<GameDiagnostics | null>(null);
  const rendererQualityProfile = useRendererQualityProfile();
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>(() => ({
    name: portalBootstrap?.playerName ?? "",
    paletteName: portalBootstrap?.paletteName ?? chickenPalettes[0]!.name,
  }));
  const [runtimeCaptureMode, setRuntimeCaptureMode] =
    useState<RuntimeCaptureMode>(() =>
      portalBootstrap ? "free" : "locked",
    );
  const [portalArrivalState, setPortalArrivalState] = useState(portalBootstrap);
  const [initialChickenRadioState] = useState<{
    playbackState: ChickenRadioPlaybackState;
    settings: ChickenRadioSettings;
  }>(() => {
    const settings = loadChickenRadioSettings();
    return {
      playbackState:
        settings.playbackPreference === "play" ? "loading" : "paused",
      settings,
    };
  });
  const [chickenRadioSettings, setChickenRadioSettings] =
    useState<ChickenRadioSettings>(() => initialChickenRadioState.settings);
  const [chickenRadioPlaybackState, setChickenRadioPlaybackState] =
    useState<ChickenRadioPlaybackState>(
      () => initialChickenRadioState.playbackState,
    );
  const [chickenRadioExpanded, setChickenRadioExpanded] = useState(false);
  const [chickenRadioPlayAttemptToken, setChickenRadioPlayAttemptToken] =
    useState(0);
  const [runtimeControlSettings, setRuntimeControlSettings] =
    useState<RuntimeControlSettings>(() => loadRuntimeControlSettings());
  const [multiplayerClient] = useState(
    () => injectedMultiplayerClient ?? new MultiplayerClient(),
  );
  const [multiplayer, setMultiplayer] = useState<MultiplayerSnapshot>(() =>
    multiplayerClient.getSnapshot(),
  );

  const updateStatus = useCallback((message: string) => {
    startTransition(() => {
      setStatusMessage(message);
    });
  }, []);

  const mapPersistence = useMapPersistence({
    onStatus: updateStatus,
  });

  const clearLaunchTimers = useCallback(() => {
    for (const timer of launchTimersRef.current) {
      window.clearTimeout(timer);
    }
    launchTimersRef.current = [];
  }, []);

  const cancelLaunchSequence = useCallback(() => {
    clearLaunchTimers();
    setLaunchState(null);
  }, [clearLaunchTimers]);

  useEffect(() => {
    pauseStateRef.current = pauseState;
  }, [pauseState]);

  useEffect(() => () => clearLaunchTimers(), [clearLaunchTimers]);

  useEffect(() => {
    const unsubscribe = multiplayerClient.subscribe(setMultiplayer);
    void multiplayerClient.boot();
    return () => {
      unsubscribe();
      multiplayerClient.dispose();
    };
  }, [multiplayerClient]);

  useEffect(() => {
    const displayName = multiplayer.profile?.displayName?.trim();
    if (!displayName) {
      return;
    }

    setPlayerProfile((current) =>
      current.name.trim().length > 0
        ? current
        : {
            ...current,
            name: displayName,
          },
    );
  }, [multiplayer.profile?.displayName]);

  const rearmMenuLoading = useCallback(() => {
    const nextToken = menuLoadTokenRef.current + 1;
    menuLoadTokenRef.current = nextToken;
    setMenuLoadToken(nextToken);
    setMenuLoading(true);
  }, []);

  const handleMenuReadyToDisplay = useCallback(() => {
    if (menuLoadTokenRef.current !== menuLoadToken) {
      return;
    }

    setMenuLoading(false);
  }, [menuLoadToken]);

  const activePlayMode =
    mode === "explore" || mode === "playNpc" || mode === "multiplayer"
      ? mode
      : mode === "rules" && rulesOrigin === "pause"
        ? runtimeModeRef.current
        : null;
  const isMenu = mode === "menu";
  const isMultiplayerMenu = mode === "multiplayerMenu";
  const isMenuShell = isMenu || isMultiplayerMenu;
  const isRulesFromMenu =
    mode === "rules" &&
    (rulesOrigin === "menu" || rulesOrigin === "multiplayerMenu");
  const isRulesFromPause = mode === "rules" && rulesOrigin === "pause";
  const isEditor = mode === "editor";
  const isRuntimePlay = activePlayMode !== null;
  const canvasTitle = "Map Workshop";
  const trimmedPlayerName = playerProfile.name.trim();
  const paletteUnlocked = trimmedPlayerName.length > 0;
  const canStartMatch = paletteUnlocked && playerProfile.paletteName !== null;
  const explorePortalRuntimeConfig = useMemo(
    () =>
      buildExplorePortalRuntimeConfig(editorDocument, {
        includeReturnPortal:
          portalArrivalState !== null &&
          portalArrivalState.incomingRefUrl !== null,
      }),
    [editorDocument, portalArrivalState?.incomingRefUrl],
  );
  const runtimePortalScene =
    activePlayMode === "explore" ? explorePortalRuntimeConfig.scene : null;
  const portalArrivalSpawnOverride =
    activePlayMode === "explore" &&
    portalArrivalState?.localPlayerSpawnOverride &&
    explorePortalRuntimeConfig.arrivalAnchor
      ? {
          ...portalArrivalState.localPlayerSpawnOverride,
          anchor: explorePortalRuntimeConfig.arrivalAnchor,
        }
      : null;
  const selectedPreviewPalette =
    chickenPalettes.find(
      (palette) => palette.name === playerProfile.paletteName,
    ) ?? chickenPalettes[0]!;
  const selectedPreviewPaletteName = selectedPreviewPalette.name;
  const multiplayerIdentityTitle = getMultiplayerIdentityTitle(
    multiplayer,
    playerProfile.name,
  );
  const multiplayerIdentityDetail = getMultiplayerIdentityDetail(
    multiplayer,
    playerProfile.name,
  );
  const chickenRadioStation = getChickenRadioStation(
    chickenRadioSettings.stationId,
  );
  const chickenRadioCanExpand =
    isMenuShell || (isRuntimePlay && pauseState.paused);
  const chickenRadioIsOnAir =
    chickenRadioSettings.playbackPreference === "play" &&
    chickenRadioPlaybackState !== "blocked";

  useEffect(() => {
    if (isRuntimePlay && !pauseState.paused) {
      setChickenRadioExpanded(false);
    }
  }, [isRuntimePlay, pauseState.paused]);

  const releaseLaunchSequence = useCallback((resumeRuntime: boolean) => {
    clearLaunchTimers();
    setLaunchState((current) =>
      current ? { ...current, phase: "dropping" } : current,
    );
    if (resumeRuntime) {
      hostRef.current?.setRuntimePaused(false);
    }
    launchTimersRef.current = [
      window.setTimeout(() => {
        setLaunchState(null);
        const currentPauseState = pauseStateRef.current;
        if (
          !resumeRuntime &&
          currentPauseState.pointerLocked &&
          currentPauseState.pointerCaptureFailureReason === null
        ) {
          hostRef.current?.setRuntimePaused(false);
        }
      }, launchTimings.drop),
    ];
  }, [clearLaunchTimers]);

  useEffect(() => {
    if (
      launchState !== null ||
      !isRuntimePlay ||
      !pauseState.paused ||
      !pauseState.pointerLocked ||
      pauseState.pointerCapturePending ||
      pauseState.pointerCaptureFailureReason !== null
    ) {
      return;
    }

    hostRef.current?.setRuntimePaused(false);
  }, [
    isRuntimePlay,
    launchState,
    pauseState.paused,
    pauseState.pointerCaptureFailureReason,
    pauseState.pointerCapturePending,
    pauseState.pointerLocked,
  ]);

  useEffect(() => {
    if (activePlayMode !== "multiplayer") {
      return;
    }

    hostRef.current?.setRuntimePaused(false);
  }, [activePlayMode, multiplayer.activeRoom?.roomId]);

  const handleEditorStateChange = useCallback((nextState: EditorPanelState) => {
    setEditorState(nextState);
  }, []);

  const handlePlayerNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPlayerProfile((current) => ({
        ...current,
        name: event.target.value,
      }));
    },
    [],
  );

  const handlePalettePick = useCallback(
    (paletteName: PlayerProfile["paletteName"]) => {
      if (!paletteUnlocked) {
        return;
      }

      setPlayerProfile((current) => ({
        ...current,
        paletteName,
      }));
    },
    [paletteUnlocked],
  );

  const updateChickenRadioSettings = useCallback(
    (patch: Partial<ChickenRadioSettings>) => {
      setChickenRadioSettings((current) => {
        const nextSettings = normalizeChickenRadioSettings({
          ...current,
          ...patch,
        });
        saveChickenRadioSettings(nextSettings);
        return nextSettings;
      });
    },
    [],
  );

  const handleChickenRadioPlaybackResume = useCallback(() => {
    updateChickenRadioSettings({
      playbackPreference: "play",
    });
    setChickenRadioPlaybackState("loading");
    setChickenRadioPlayAttemptToken((current) => current + 1);
  }, [updateChickenRadioSettings]);

  const handleChickenRadioPlaybackPause = useCallback(() => {
    updateChickenRadioSettings({
      playbackPreference: "pause",
    });
    setChickenRadioPlaybackState("paused");
  }, [updateChickenRadioSettings]);

  const handleChickenRadioTogglePlayback = useCallback(() => {
    if (chickenRadioIsOnAir) {
      handleChickenRadioPlaybackPause();
      return;
    }

    handleChickenRadioPlaybackResume();
  }, [
    chickenRadioIsOnAir,
    handleChickenRadioPlaybackPause,
    handleChickenRadioPlaybackResume,
  ]);

  const handleChickenRadioStationSelect = useCallback(
    (stationId: ChickenRadioSettings["stationId"]) => {
      updateChickenRadioSettings({
        stationId,
      });
      if (chickenRadioSettings.playbackPreference === "play") {
        setChickenRadioPlaybackState("loading");
      }
    },
    [chickenRadioSettings.playbackPreference, updateChickenRadioSettings],
  );

  const handleChickenRadioVolumeChange = useCallback(
    (volume: number) => {
      updateChickenRadioSettings({
        volume,
      });
    },
    [updateChickenRadioSettings],
  );

  const handleChickenRadioExpandedChange = useCallback(
    (expanded: boolean) => {
      if (expanded && !chickenRadioCanExpand) {
        setChickenRadioExpanded(false);
        return;
      }

      setChickenRadioExpanded(expanded);
    },
    [chickenRadioCanExpand],
  );

  const handleRuntimeControlSettingsChange = useCallback(
    (patch: Partial<RuntimeControlSettings>) => {
      setRuntimeControlSettings((current) => {
        const nextSettings = normalizeRuntimeControlSettings({
          ...current,
          ...patch,
        });
        saveRuntimeControlSettings(nextSettings);
        return nextSettings;
      });
    },
    [],
  );

  const handleRuntimeControlSettingsReset = useCallback(() => {
    resetRuntimeControlSettings();
    setRuntimeControlSettings(createDefaultRuntimeControlSettings());
  }, []);

  const createMultiplayerWorker = useCallback(
    () => multiplayerClient.createWorkerBridge(),
    [multiplayerClient],
  );

  const handlePortalTriggered = useCallback(
    (portalId: string, snapshot: Parameters<typeof buildPortalRedirectUrl>[0]["snapshot"]) => {
      if (typeof window === "undefined") {
        return;
      }

      const redirectUrl = buildPortalRedirectUrl({
        currentGameUrl: getCurrentGameUrl(window.location),
        incomingRefUrl: portalArrivalState?.incomingRefUrl ?? null,
        forwardedParams: portalArrivalState?.forwardedParams ?? {},
        matchColorSeed,
        paletteName: playerProfile.paletteName,
        playerName: playerProfile.name,
        portalId,
        snapshot,
      });
      if (!redirectUrl) {
        return;
      }

      window.location.assign(redirectUrl);
    },
    [
      matchColorSeed,
      playerProfile.name,
      playerProfile.paletteName,
      portalArrivalState?.forwardedParams,
      portalArrivalState?.incomingRefUrl,
    ],
  );

  const enterMultiplayerRoom = useCallback(() => {
    cancelLaunchSequence();
    runtimeModeRef.current = "multiplayer";
    setRulesOrigin(null);
    setMode("multiplayer");
    setHudState(null);
    setDiagnostics(null);
    setPauseState({
      hasStarted: false,
      paused: false,
      pointerLocked: false,
      pointerCapturePending: false,
      pointerCaptureFailureReason: null,
    });
    updateStatus(
      multiplayer.activeRoom?.countdown.reason ?? "Multiplayer room ready.",
    );
  }, [cancelLaunchSequence, multiplayer.activeRoom?.countdown.reason, updateStatus]);

  const handleQuickJoinMultiplayer = useCallback(async () => {
    if (!trimmedPlayerName) {
      updateStatus("Type your name once so we can save your multiplayer account.");
      return;
    }

    try {
      updateStatus("Joining a multiplayer room...");
      await multiplayerClient.quickJoin(trimmedPlayerName);
      enterMultiplayerRoom();
    } catch (error) {
      updateStatus(
        error instanceof Error
          ? error.message
          : "Could not join a multiplayer room.",
      );
    }
  }, [enterMultiplayerRoom, multiplayerClient, trimmedPlayerName, updateStatus]);

  const handleJoinSpecificRoom = useCallback(
    async (roomId: string) => {
      if (!trimmedPlayerName) {
        updateStatus("Type your name once so we can save your multiplayer account.");
        return;
      }

      try {
        updateStatus(`Joining ${roomId}...`);
        await multiplayerClient.joinRoom(roomId, trimmedPlayerName);
        enterMultiplayerRoom();
      } catch (error) {
        updateStatus(
          error instanceof Error
            ? error.message
            : "Could not join that room.",
        );
      }
    },
    [enterMultiplayerRoom, multiplayerClient, trimmedPlayerName, updateStatus],
  );

  const openMultiplayerMenu = useCallback(async () => {
    setRulesOrigin(null);
    setMode("multiplayerMenu");

    if (!trimmedPlayerName) {
      updateStatus("Type your name once and then you will be ready to play.");
      return;
    }

    try {
      await multiplayerClient.ensureReady(trimmedPlayerName);
      updateStatus("Pick a room or quick join the best one.");
    } catch (error) {
      updateStatus(
        error instanceof Error
          ? error.message
          : "Could not prepare multiplayer right now.",
      );
    }
  }, [multiplayerClient, trimmedPlayerName, updateStatus]);

  const returnToMainMenu = useCallback(() => {
    setRulesOrigin(null);
    setMode("menu");
    updateStatus("Back to the main menu.");
  }, [updateStatus]);

  const openRulesFromMenu = useCallback(() => {
    setRulesOrigin(isMultiplayerMenu ? "multiplayerMenu" : "menu");
    setMode("rules");
  }, [isMultiplayerMenu]);

  const openRulesFromPause = useCallback(() => {
    if (!activePlayMode) {
      return;
    }

    runtimeModeRef.current = activePlayMode;
    setRulesOrigin("pause");
    setMode("rules");
  }, [activePlayMode]);

  const closeRules = useCallback(() => {
    if (rulesOrigin === "pause") {
      setMode(runtimeModeRef.current);
    } else if (rulesOrigin === "multiplayerMenu") {
      setMode("multiplayerMenu");
    } else {
      rearmMenuLoading();
      setMode("menu");
    }
    setRulesOrigin(null);
  }, [rearmMenuLoading, rulesOrigin]);

  const enterMode = useCallback(
    (nextMode: ActiveShellMode) => {
      if (nextMode === "explore" || nextMode === "playNpc") {
        runtimeModeRef.current = nextMode;
      }
      setRulesOrigin(null);
      setMode((currentMode) => {
        if (currentMode === "menu") {
          setMatchColorSeed((value) => value + 1);
        }
        return nextMode;
      });
      setHudState(null);
      setPauseState({
        hasStarted: false,
        paused: nextMode === "explore" || nextMode === "playNpc",
        pointerLocked: false,
        pointerCapturePending: false,
        pointerCaptureFailureReason: null,
      });
      updateStatus(getModeStatusMessage(nextMode));
    },
    [updateStatus],
  );

  const createFreshArena = useCallback(() => {
    const nextDocument = createDefaultArenaMap();
    setEditorDocument(nextDocument);
    setEditorState(createDefaultEditorPanelState(nextDocument));
    mapPersistence.setSelectedMapId(null);
    hostRef.current?.loadMap(nextDocument);
    updateStatus("Loaded a fresh default arena.");
  }, [mapPersistence, updateStatus]);

  const beginMode = useCallback(
    (nextMode: GameMode) => {
      if (!canStartMatch) {
        return;
      }

      setRuntimeCaptureMode("locked");
      setPortalArrivalState(null);
      clearLaunchTimers();
      flushSync(() => {
        enterMode(nextMode);
        setLaunchState({
          mode: nextMode,
          phase: "dimming",
        });
      });

      hostRef.current?.setRuntimePaused(true);
      hostRef.current?.requestPointerLock();

      launchTimersRef.current.push(
        window.setTimeout(() => {
          setLaunchState((current) =>
            current ? { ...current, phase: "staging" } : current,
          );
        }, launchTimings.dim),
      );
      launchTimersRef.current.push(
        window.setTimeout(() => {
          releaseLaunchSequence(pauseStateRef.current.pointerLocked);
        }, launchTimings.dim + launchTimings.stage),
      );
    },
    [canStartMatch, clearLaunchTimers, enterMode, releaseLaunchSequence],
  );

  const returnToEditor = useCallback(() => {
    cancelLaunchSequence();
    setRulesOrigin(null);
    enterMode("editor");
  }, [cancelLaunchSequence, enterMode]);

  const returnToMenu = useCallback(async () => {
    cancelLaunchSequence();
    setRulesOrigin(null);
    setRuntimeCaptureMode("locked");
    setPortalArrivalState(null);
    if (activePlayMode === "multiplayer") {
      await multiplayerClient.leaveRoom();
    }
    const nextDocument = await hostRef.current?.getEditorDocument();
    if (nextDocument) {
      setEditorDocument(nextDocument);
      setEditorState((current) => ({
        ...current,
        mapName: nextDocument.meta.name,
      }));
    }

    setHudState(null);
    setPauseState(createDefaultPauseState());
    setDiagnostics(null);
    rearmMenuLoading();
    setMode("menu");
    updateStatus("Back to the main menu.");
  }, [activePlayMode, cancelLaunchSequence, multiplayerClient, rearmMenuLoading, updateStatus]);

  const saveCurrentMap = useCallback(async () => {
    const document =
      (await hostRef.current?.getEditorDocument()) ?? editorDocument;
    const id = await mapPersistence.saveCurrentMap(
      document,
      mapPersistence.selectedMapId,
    );
    setEditorDocument(document);
    mapPersistence.setSelectedMapId(id);
  }, [editorDocument, mapPersistence]);

  const loadSelectedMap = useCallback(async () => {
    const record = await mapPersistence.loadCurrentMap();
    if (!record) {
      return;
    }

    setEditorDocument(record.document);
    setEditorState((current) => ({
      ...current,
      mapName: record.document.meta.name,
    }));
    hostRef.current?.loadMap(record.document);
    updateStatus(`Loaded "${record.name}".`);
  }, [mapPersistence, updateStatus]);

  const deleteSelectedMap = useCallback(async () => {
    await mapPersistence.deleteCurrentMap();
  }, [mapPersistence]);

  const exportCurrentMap = useCallback(async () => {
    const document =
      (await hostRef.current?.getEditorDocument()) ?? editorDocument;
    mapPersistence.exportCurrentMap(document, editorState.mapName);
  }, [editorDocument, editorState.mapName, mapPersistence]);

  const handleImportMap = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const document = await mapPersistence.importMapFile(file);
        if (!document) {
          return;
        }

        setEditorDocument(document);
        setEditorState((current) => ({
          ...current,
          mapName: document.meta.name,
        }));
        mapPersistence.setSelectedMapId(null);
        hostRef.current?.loadMap(document);
        updateStatus(`Imported "${document.meta.name}".`);
      } finally {
        event.target.value = "";
      }
    },
    [mapPersistence, updateStatus],
  );

  if (isRulesFromMenu) {
    return (
      <div className="app-root">
        <ChickenRadioPlayerHost
          onPlaybackStateChange={setChickenRadioPlaybackState}
          playAttemptToken={chickenRadioPlayAttemptToken}
          playbackPreference={chickenRadioSettings.playbackPreference}
          station={chickenRadioStation}
          volume={chickenRadioSettings.volume}
        />
        <RulesAndControlsScreen onBack={closeRules} />
      </div>
    );
  }

  if (isMenuShell) {
    return (
      <div className="app-root">
        <ChickenRadioPlayerHost
          onPlaybackStateChange={setChickenRadioPlaybackState}
          playAttemptToken={chickenRadioPlayAttemptToken}
          playbackPreference={chickenRadioSettings.playbackPreference}
          station={chickenRadioStation}
          volume={chickenRadioSettings.volume}
        />
        <main className="menu-shell">
          <div className="menu-background">
            <GameHost
              initialDocument={editorDocument}
              matchColorSeed={matchColorSeed}
              mode="editor"
              onReadyToDisplay={handleMenuReadyToDisplay}
              playerProfile={playerProfile}
              presentation="menu"
              qualityTier={rendererQualityProfile.tier}
              runtimeSettings={runtimeControlSettings}
            />
          </div>
          <div
            className="menu-screen-gradient"
            style={
              {
                "--preview-gradient-solid": hexToRgba(
                  selectedPreviewPalette.body,
                  0.92,
                ),
                "--preview-gradient-mid": hexToRgba(
                  selectedPreviewPalette.shade,
                  0.54,
                ),
                "--preview-gradient-soft": hexToRgba(
                  selectedPreviewPalette.body,
                  0.14,
                ),
              } as CSSProperties
            }
          />
          <div className="menu-top-right-stack">
            <ChickenRadioOverlay
              expanded={chickenRadioExpanded && chickenRadioCanExpand}
              interactive
              onSelectStation={handleChickenRadioStationSelect}
              onSetExpanded={handleChickenRadioExpandedChange}
              onTogglePlayback={handleChickenRadioTogglePlayback}
              onVolumeChange={handleChickenRadioVolumeChange}
              playbackState={chickenRadioPlaybackState}
              station={chickenRadioStation}
              stations={chickenRadioStations}
              variant="menu"
              volume={chickenRadioSettings.volume}
            />
            <div className="menu-corner-status" role="status">
              <span className="menu-corner-status__title">
                {multiplayerIdentityTitle}
              </span>
              <span className="menu-corner-status__detail">
                {multiplayerIdentityDetail}
              </span>
            </div>
          </div>
          <div className="menu-overlay">
            <section className="menu-sidebar">
              <div className="menu-sidebar__content">
                <h1 className="menu-title">HoldMyEgg</h1>
                <label className="field">
                  <span>Player Name</span>
                  <input
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    maxLength={18}
                    onChange={handlePlayerNameChange}
                    placeholder="TYPE YOUR NAME"
                    spellCheck={false}
                    value={playerProfile.name}
                  />
                </label>
                <div className="field">
                  <span>Chicken Color</span>
                  <div
                    aria-label="Chicken Color"
                    className={`menu-palette-grid ${paletteUnlocked ? "" : "menu-palette-grid--locked"}`.trim()}
                    role="radiogroup"
                  >
                    {chickenPalettes.map((palette) => {
                      const selected = playerProfile.paletteName === palette.name;
                      return (
                        <button
                          aria-checked={selected}
                          aria-label={`${palette.name} chicken`}
                          className={`palette-swatch ${selected ? "palette-swatch--selected" : ""}`.trim()}
                          disabled={!paletteUnlocked}
                          key={palette.name}
                          onClick={() => handlePalettePick(palette.name)}
                          role="radio"
                          style={
                            {
                              "--swatch-body": palette.body,
                              "--swatch-shade": palette.shade,
                              "--swatch-ring": palette.ringAccent,
                            } as CSSProperties
                          }
                          title={palette.name}
                          type="button"
                        >
                          <span className="palette-swatch__chip" />
                          <span className="palette-swatch__name">
                            {palette.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {!paletteUnlocked && (
                    <span className="menu-hint">
                      Type your name to unlock the coop colors.
                    </span>
                  )}
                </div>

                {isMenu && (
                  <div
                    aria-label="Modes"
                    className="menu-primary-actions"
                    role="group"
                  >
                    {multiplayer.available && (
                      <button
                        className="menu-action menu-action--full menu-action--hero"
                        disabled={multiplayer.joining}
                        onClick={() => {
                          void openMultiplayerMenu();
                        }}
                        type="button"
                      >
                        {`Multiplayer · ${multiplayer.onlinePlayers} online`}
                      </button>
                    )}
                    <button
                      className="menu-action menu-action--full menu-action--hero-secondary"
                      disabled={!canStartMatch}
                      onClick={() => beginMode("explore")}
                      type="button"
                    >
                      Explore
                    </button>
                    <button
                      className="menu-action menu-action--full menu-action--compact"
                      disabled={!canStartMatch}
                      onClick={() => beginMode("playNpc")}
                      type="button"
                    >
                      PLAY NPC
                    </button>
                  </div>
                )}
                {isMultiplayerMenu && (
                  <section className="multiplayer-menu-screen">
                    <div className="multiplayer-menu-screen__header">
                      <div>
                        <span className="menu-kicker">Multiplayer</span>
                        <h2>US Rooms</h2>
                      </div>
                      <button
                        className="menu-action menu-action--compact"
                        onClick={returnToMainMenu}
                        type="button"
                      >
                        Back
                      </button>
                    </div>
                    <p className="multiplayer-menu-screen__copy">
                      {multiplayer.available
                        ? "Watch the live room flow, quick join the best match, or pick a room."
                        : "Multiplayer is offline right now. We will keep checking for it."}
                    </p>
                    {multiplayer.available && (
                      <MultiplayerRoomCards
                        busy={multiplayer.joining}
                        onJoinRoom={(roomId) => {
                          void handleJoinSpecificRoom(roomId);
                        }}
                        onQuickJoin={() => {
                          void handleQuickJoinMultiplayer();
                        }}
                        rooms={multiplayer.rooms}
                        sessionReady={!multiplayer.booting && canStartMatch}
                      />
                    )}
                  </section>
                )}
                {isMenu && (
                  <div className="menu-utility">
                    <div
                      aria-label="Menu links"
                      className="menu-secondary-actions"
                      role="group"
                    >
                      <button
                        className="menu-action menu-action--full menu-action--compact"
                        onClick={openRulesFromMenu}
                        type="button"
                      >
                        Rules / Shortcuts
                      </button>
                      {/* <button
                        className="menu-action menu-action--secondary menu-action--full menu-action--compact"
                        onClick={onOpenSupportWidget}
                        type="button"
                      >
                        Feedback / bug
                      </button> */}
                    </div>
                    <section className="menu-controls-panel">
                      <button
                        aria-expanded={menuControlsOpen}
                        className="menu-controls-panel__toggle"
                        onClick={() =>
                          setMenuControlsOpen((current) => !current)
                        }
                        type="button"
                      >
                        <span className="menu-controls-panel__copy">
                          <span className="menu-controls-panel__title">
                            Controls
                          </span>
                          <span className="menu-controls-panel__summary">
                            Saved locally ·{" "}
                            {getRuntimeControlsSummary(runtimeControlSettings)}
                          </span>
                        </span>
                        <span className="menu-controls-panel__state">
                          {menuControlsOpen ? "Hide" : "Edit"}
                        </span>
                      </button>
                      {menuControlsOpen && (
                        <div className="menu-controls-panel__body">
                          <RuntimeControlsSettings
                            onReset={handleRuntimeControlSettingsReset}
                            onSettingsChange={
                              handleRuntimeControlSettingsChange
                            }
                            settings={runtimeControlSettings}
                            variant="menu"
                          />
                        </div>
                      )}
                    </section>
                    <p className="menu-credit">
                      Made by{" "}
                      <a
                        href="https://x.com/anthonyriera"
                        rel="noreferrer"
                        target="_blank"
                      >
                        Anthony Riera
                      </a>{" "}
                      and{" "}
                      <a
                        href="https://cossistant.com"
                        rel="noreferrer"
                        target="_blank"
                      >
                        cossistant.com
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section aria-label="Chicken Preview" className="menu-preview-stage">
              <ChickenPreview
                paletteName={selectedPreviewPaletteName}
                variant="menu"
              />
            </section>
          </div>
          {menuLoading && <BootSplashScreen />}
        </main>
      </div>
    );
  }

  if (isRuntimePlay) {
    return (
      <div className="app-root">
        <ChickenRadioPlayerHost
          onPlaybackStateChange={setChickenRadioPlaybackState}
          playAttemptToken={chickenRadioPlayAttemptToken}
          playbackPreference={chickenRadioSettings.playbackPreference}
          station={chickenRadioStation}
          volume={chickenRadioSettings.volume}
        />
        <main className="play-shell">
          <div className="play-canvas">
            <GameHost
              initialDocument={editorDocument}
              initialSpawnStyle="sky"
              localPlayerSpawnOverride={portalArrivalSpawnOverride}
              matchColorSeed={matchColorSeed}
              mode={activePlayMode}
              captureMode={
                activePlayMode === "explore" ? runtimeCaptureMode : "locked"
              }
              portalScene={runtimePortalScene}
              playerProfile={playerProfile}
              onDiagnostics={setDiagnostics}
              onEditorStateChange={handleEditorStateChange}
              onHudStateChange={setHudState}
              onPauseStateChange={setPauseState}
              onPortalTriggered={handlePortalTriggered}
              onStatus={updateStatus}
              qualityTier={rendererQualityProfile.tier}
              ref={hostRef}
              runtimeSettings={runtimeControlSettings}
              workerFactory={
                activePlayMode === "multiplayer"
                  ? createMultiplayerWorker
                  : undefined
              }
            />
            {launchState && (
              <LaunchOverlay
                paletteName={selectedPreviewPaletteName}
                phase={launchState.phase}
              />
            )}
            {activePlayMode === "multiplayer" && multiplayer.activeRoom && (
              <MultiplayerRoomOverlay
                chat={multiplayer.chat}
                connectionStatus={multiplayer.connectionStatus}
                localUserId={multiplayer.sessionUserId}
                onChatSend={(text) => multiplayerClient.sendChat(text)}
                onReturnToMenu={() => {
                  void returnToMenu();
                }}
                room={multiplayer.activeRoom}
              />
            )}
            {isRulesFromPause && <RulesAndControlsScreen onBack={closeRules} />}
            {!launchState && !isRulesFromPause && (
              <>
                <div
                  className={`runtime-top-right-stack ${activePlayMode === "multiplayer" && multiplayer.activeRoom ? "runtime-top-right-stack--multiplayer" : ""}`.trim()}
                >
                  {!pauseState.paused && (
                    <ChickenRadioRuntimeLabel station={chickenRadioStation} />
                  )}
                  {diagnostics?.render && (
                    <RuntimeFpsIndicator diagnostics={diagnostics} />
                  )}
                </div>
                <Hud
                  hudState={hudState}
                  mode={activePlayMode}
                />
              </>
            )}
            {pauseState.paused && !launchState && !isRulesFromPause && (
              <RuntimePauseOverlay
                captureMode={
                  activePlayMode === "explore" ? runtimeCaptureMode : "locked"
                }
                chickenRadioControl={
                  <ChickenRadioOverlay
                    expanded={chickenRadioExpanded && chickenRadioCanExpand}
                    interactive
                    onSelectStation={handleChickenRadioStationSelect}
                    onSetExpanded={handleChickenRadioExpandedChange}
                    onTogglePlayback={handleChickenRadioTogglePlayback}
                    onVolumeChange={handleChickenRadioVolumeChange}
                    playbackState={chickenRadioPlaybackState}
                    station={chickenRadioStation}
                    stations={chickenRadioStations}
                    variant="menu"
                    volume={chickenRadioSettings.volume}
                  />
                }
                hasStarted={pauseState.hasStarted}
                onRuntimeControlSettingsChange={
                  handleRuntimeControlSettingsChange
                }
                onRuntimeControlSettingsReset={handleRuntimeControlSettingsReset}
                onResume={() => hostRef.current?.resumeRuntime()}
                onShowRules={openRulesFromPause}
                onReturnToMenu={() => {
                  void returnToMenu();
                }}
                pointerCaptureFailureReason={
                  pauseState.pointerCaptureFailureReason
                }
                pointerCapturePending={pauseState.pointerCapturePending}
                runtimeControlSettings={runtimeControlSettings}
              />
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-root">
      <ChickenRadioPlayerHost
        onPlaybackStateChange={setChickenRadioPlaybackState}
        playAttemptToken={chickenRadioPlayAttemptToken}
        playbackPreference={chickenRadioSettings.playbackPreference}
        station={chickenRadioStation}
        volume={chickenRadioSettings.volume}
      />
      <div className="app-shell">
        <aside className="control-panel">
        <div className="panel-head">
          <p className="panel-kicker">Voxel Arena Prototype</p>
          <h1>HoldMyEgg</h1>
          <p className="panel-copy">
            Build the map, tune the feel, then launch back into the arena when
            the layout is ready.
          </p>
        </div>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Mode</h2>
            <span className="mode-chip">{getModeLabel("editor")}</span>
          </div>
          <div className="button-grid">
            <button
              className={isEditor ? "is-active" : ""}
              onClick={returnToEditor}
              type="button"
            >
              Workshop
            </button>
            <button
              disabled={!canStartMatch}
              onClick={() => beginMode("explore")}
              type="button"
            >
              Explore
            </button>
            <button
              disabled={!canStartMatch}
              onClick={() => beginMode("playNpc")}
              type="button"
            >
              PLAY NPC
            </button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Map</h2>
            <span className="mode-chip">
              {editorDocument.size.x} x {editorDocument.size.z}
            </span>
          </div>
          <label className="field">
            <span>Name</span>
            <input
              onChange={(event) =>
                hostRef.current?.setEditorState({ mapName: event.target.value })
              }
              value={editorState.mapName}
            />
          </label>
          <div className="button-row">
            <button onClick={createFreshArena} type="button">
              New Arena
            </button>
            <button onClick={saveCurrentMap} type="button">
              Save
            </button>
            <button
              onClick={() => {
                void exportCurrentMap();
              }}
              type="button"
            >
              Export
            </button>
          </div>
          <label className="field">
            <span>Import JSON</span>
            <input
              accept=".json,application/json"
              onChange={handleImportMap}
              type="file"
            />
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Editor</h2>
            <span className="mode-chip">Left click</span>
          </div>
          <div className="button-grid">
            <button
              className={editorState.tool === "add" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "add" })}
              type="button"
            >
              Add
            </button>
            <button
              className={editorState.tool === "erase" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "erase" })}
              type="button"
            >
              Erase
            </button>
            <button
              className={editorState.tool === "spawn" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "spawn" })}
              type="button"
            >
              Spawn
            </button>
            <button
              className={editorState.tool === "prop" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "prop" })}
              type="button"
            >
              Prop
            </button>
            <button
              className={editorState.tool === "feature" ? "is-active" : ""}
              onClick={() => hostRef.current?.setEditorState({ tool: "feature" })}
              type="button"
            >
              Feature
            </button>
          </div>
          <label className="field">
            <span>Cube Type</span>
            <select
              disabled={editorState.tool !== "add"}
              onChange={(event) =>
                hostRef.current?.setEditorState({
                  blockKind: event.target
                    .value as (typeof blockKindOptions)[number],
                })
              }
              value={editorState.blockKind}
            >
              {blockKindOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Prop Type</span>
            <select
              disabled={editorState.tool !== "prop"}
              onChange={(event) =>
                hostRef.current?.setEditorState({
                  propKind: event.target
                    .value as (typeof propKindOptions)[number],
                })
              }
              value={editorState.propKind}
            >
              {propKindOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Feature Type</span>
            <select
              disabled={editorState.tool !== "feature"}
              onChange={(event) =>
                hostRef.current?.setEditorState({
                  featureKind: event.target
                    .value as (typeof featureKindOptions)[number],
                })
              }
              value={editorState.featureKind}
            >
              {featureKindOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Feature Direction</span>
            <select
              disabled={editorState.tool !== "feature"}
              onChange={(event) =>
                hostRef.current?.setEditorState({
                  featureDirection: event.target
                    .value as (typeof waterfallDirectionOptions)[number],
                })
              }
              value={editorState.featureDirection}
            >
              {waterfallDirectionOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>Saved Maps</h2>
            <span className="mode-chip">{mapPersistence.savedMaps.length}</span>
          </div>
          <label className="field">
            <span>Saved Slot</span>
            <select
              onChange={(event) =>
                mapPersistence.setSelectedMapId(event.target.value || null)
              }
              value={mapPersistence.selectedMapId ?? ""}
            >
              <option value="">Select a save</option>
              {mapPersistence.savedMaps.map((savedMap) => (
                <option key={savedMap.id} value={savedMap.id}>
                  {savedMap.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button onClick={loadSelectedMap} type="button">
              Load
            </button>
            <button onClick={deleteSelectedMap} type="button">
              Delete
            </button>
          </div>
        </section>

        <section className="panel-section panel-section--status">
          <h2>Status</h2>
          <p>{statusMessage}</p>
        </section>
        </aside>

        <main className="stage">
        <header className="stage-head">
          <div>
            <p className="panel-kicker">Current View</p>
            <h2>{canvasTitle}</h2>
          </div>
          <div className="stage-head__actions">
            <p className="stage-copy">
              Minecraft-like cubes, party-game pacing, and a renderer path
              designed to survive the jump to multiplayer.
            </p>
            <button
              onClick={() => {
                void returnToMenu();
              }}
              type="button"
            >
              Menu
            </button>
          </div>
        </header>

        <div className="canvas-card">
          <GameHost
            initialDocument={editorDocument}
            matchColorSeed={matchColorSeed}
            mode="editor"
            playerProfile={playerProfile}
            onDiagnostics={setDiagnostics}
            onEditorStateChange={handleEditorStateChange}
            onHudStateChange={setHudState}
            onPauseStateChange={setPauseState}
            onStatus={updateStatus}
            qualityTier={rendererQualityProfile.tier}
            ref={hostRef}
            runtimeSettings={runtimeControlSettings}
          />
          <Hud hudState={hudState} mode="editor" />
          {import.meta.env.DEV && diagnostics && (
            <div className="terrain-stats-overlay">
              <p>Mode {diagnostics.mode.toUpperCase()}</p>
              <p>Tick {diagnostics.tick.toLocaleString()}</p>
              <p>Terrain Rev {diagnostics.terrainRevision.toLocaleString()}</p>
              <p>Dirty Chunks {diagnostics.dirtyChunkCount.toLocaleString()}</p>
              {diagnostics.render && (
                <>
                  <p>
                    Sun Shadows{" "}
                    {diagnostics.render.sunShadowsEnabled ? "ON" : "OFF"}
                  </p>
                  <p>
                    Shadow Refreshes{" "}
                    {diagnostics.render.shadowMapRefreshCount.toLocaleString()}
                  </p>
                </>
              )}
              <p>
                Sky Update {diagnostics.runtime.skyDropUpdateMs.toFixed(2)}ms
              </p>
              <p>
                Sky Landing {diagnostics.runtime.skyDropLandingMs.toFixed(2)}ms
              </p>
              <p>
                Collapse Scan{" "}
                {diagnostics.runtime.detachedComponentMs.toFixed(2)}ms
              </p>
              <p>
                Cluster Landing{" "}
                {diagnostics.runtime.fallingClusterLandingMs.toFixed(2)}ms
              </p>
              <p>
                Catch-up Max{" "}
                {diagnostics.runtime.fixedStepMaxStepsPerFrame.toLocaleString()}
              </p>
              <p>
                Catch-up Clamps{" "}
                {diagnostics.runtime.fixedStepClampedFrames.toLocaleString()}
              </p>
              <p>
                Catch-up Dropped{" "}
                {diagnostics.runtime.fixedStepDroppedMs.toFixed(2)}ms
              </p>
            </div>
          )}
        </div>
        </main>
      </div>
    </div>
  );
}

function BootSplashScreen() {
  return (
    <div className="boot-splash" data-testid="boot-splash">
      <div className="boot-splash__wordmark">HoldMyEgg</div>
    </div>
  );
}

function RuntimeFpsIndicator({ diagnostics }: { diagnostics: GameDiagnostics }) {
  const render = diagnostics.render;
  if (!render) {
    return null;
  }

  const badgeTone =
    render.fps >= render.targetFps
      ? "ok"
      : render.fps >= render.targetFps * 0.8
        ? "warn"
        : "hot";

  return (
    <div
      className={`fps-indicator fps-indicator--${badgeTone}`}
      data-testid="runtime-fps-badge"
    >
      FPS {render.fps.toFixed(1)}
    </div>
  );
}

function ChickenRadioRuntimeLabel({
  station,
}: {
  station: ReturnType<typeof getChickenRadioStation>;
}) {
  return (
    <div
      className="chicken-radio-runtime-label"
      data-testid="chicken-radio-runtime-label"
      role="status"
    >
      <span className="chicken-radio-runtime-label__title">Chicken Radio</span>
      <span className="chicken-radio-runtime-label__station">
        {station.frequencyLabel}
      </span>
    </div>
  );
}

function RulesAndControlsScreen({ onBack }: { onBack: () => void }) {
  return (
    <section className="rules-screen" data-testid="rules-screen">
      <div aria-hidden="true" className="rules-screen__backdrop">
        <div className="rules-screen__backdrop-wordmark">HoldMyEgg</div>
      </div>
      <div className="rules-screen__content">
        <div className="rules-screen__header">
          <div>
            <p className="panel-kicker">HoldMyEgg</p>
            <h1>Rules / Shortcuts</h1>
            <p>
              Last chicken standing. Harvest cubes, spend matter, and survive
              the mess you make.
            </p>
          </div>
          <button onClick={onBack} type="button">
            Back
          </button>
        </div>

        <div className="rules-screen__summary-grid">
          <section className="rules-screen__card">
            <h2>Win</h2>
            <p>Be the last one standing on the map.</p>
          </section>
          <section className="rules-screen__card">
            <h2>Lives</h2>
            <p>Every chicken gets 3 feathers. Lose all 3 and you are out.</p>
          </section>
          <section className="rules-screen__card">
            <h2>Matter</h2>
            <p>
              Only harvested cubes refill matter, and every big move spends it.
            </p>
          </section>
        </div>

        <section className="rules-screen__section rules-screen__section--controls">
          <div className="rules-screen__section-copy">
            <h2>Shortcuts</h2>
            <p>Shortcuts are the same in Explore and PLAY NPC.</p>
          </div>
          <ShortcutLegend bindings={getRuntimeShortcutBindings()} />
        </section>

        <div className="rules-screen__detail-grid">
          <section className="rules-screen__section">
            <div className="rules-screen__section-copy">
              <h2>Modes</h2>
              <p>Same systems, different pressure.</p>
            </div>
            <div className="rules-screen__mode-grid">
              <article className="rules-screen__mini-card">
                <h3>Explore</h3>
                <p>
                  Solo practice for movement, flying, building, pushing, and
                  eggs.
                </p>
              </article>
              <article className="rules-screen__mini-card">
                <h3>PLAY NPC</h3>
                <p>
                  Fight nine smarter chickens that pressure you, each other, and
                  the arena itself.
                </p>
              </article>
            </div>
          </section>

          <section className="rules-screen__section">
            <div className="rules-screen__section-copy">
              <h2>Watch Out</h2>
              <p>Three fast ways to lose a life.</p>
            </div>
            <ul className="rules-screen__danger-list">
              <li>Getting crushed by the map</li>
              <li>Falling out of the map</li>
              <li>Getting hit by an egg blast</li>
            </ul>
            <p className="rules-screen__pause-note">
              Press <strong>`Esc`</strong> to unlock the mouse, pause, and head
              back when you need a breather.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}

function LaunchOverlay({
  paletteName,
  phase,
}: {
  paletteName: PlayerProfile["paletteName"];
  phase: LaunchPhase;
}) {
  return (
    <div
      className={`launch-overlay launch-overlay--${phase}`.trim()}
      data-testid="launch-overlay"
    >
      <div className="launch-overlay__veil" />
      <div className="launch-overlay__content">
        <div className="launch-overlay__preview">
          {paletteName && (
            <ChickenPreview paletteName={paletteName} variant="launch" />
          )}
        </div>
      </div>
    </div>
  );
}

function RuntimePauseOverlay({
  captureMode,
  chickenRadioControl,
  hasStarted,
  onRuntimeControlSettingsChange,
  onRuntimeControlSettingsReset,
  onResume,
  onShowRules,
  onReturnToMenu,
  pointerCaptureFailureReason,
  pointerCapturePending,
  runtimeControlSettings,
}: {
  captureMode: RuntimeCaptureMode;
  chickenRadioControl: ReactNode;
  hasStarted: boolean;
  onRuntimeControlSettingsChange: (
    patch: Partial<RuntimeControlSettings>,
  ) => void;
  onRuntimeControlSettingsReset: () => void;
  onResume: () => void;
  onShowRules: () => void;
  onReturnToMenu: () => void;
  pointerCaptureFailureReason: PointerCaptureFailureReason | null;
  pointerCapturePending: boolean;
  runtimeControlSettings: RuntimeControlSettings;
}) {
  const [showControls, setShowControls] = useState(false);
  const freeLookMode = captureMode === "free";
  const isFirstCapture = !freeLookMode && !hasStarted;
  const captureFailed =
    !freeLookMode && pointerCaptureFailureReason !== null;
  const primaryLabel = pointerCapturePending
    ? "Capturing..."
    : freeLookMode
      ? "Resume"
      : isFirstCapture || captureFailed
        ? "Capture Mouse"
        : "Resume";
  const kicker = pointerCapturePending
    ? "Capturing Mouse"
    : freeLookMode
      ? "Portal Pause"
      : captureFailed
        ? "Capture Failed"
        : hasStarted
          ? "Paused"
          : "Click To Start";
  const message = pointerCapturePending
    ? "Trying to capture the mouse now. If it still does not lock, you can retry or head back to the menu."
    : freeLookMode
      ? "Explore mode is paused. Resume to jump back in."
      : pointerCaptureFailureReason
        ? getPointerCaptureFailureMessage(pointerCaptureFailureReason)
        : hasStarted
          ? "Mouse unlocked. Resume to jump back in."
          : "Capture the mouse to drop into the arena.";
  const title = pointerCapturePending
    ? "Locking The Arena"
    : freeLookMode || hasStarted
      ? "Arena On Hold"
      : "Ready To Drop";

  return (
    <div className="runtime-pause-overlay">
      <button
        aria-label={
          !freeLookMode && (isFirstCapture || captureFailed)
            ? "Capture mouse"
            : "Resume play"
        }
        className="runtime-pause-backdrop"
        disabled={pointerCapturePending}
        onClick={onResume}
        type="button"
      />
      <div
        className="runtime-pause-strip"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="runtime-pause-strip__top">
          <div className="runtime-pause-strip__intro">
            <div className="runtime-pause-strip__eyebrow">
              <p className="panel-kicker">{kicker}</p>
              <span className="runtime-pause-strip__status-chip">
                {pointerCapturePending
                  ? "WAIT"
                  : freeLookMode
                    ? "FREE LOOK"
                    : isFirstCapture || captureFailed
                    ? "UNLOCKED"
                    : "SAFE"}
              </span>
            </div>
            <h2 className="runtime-pause-strip__title">{title}</h2>
            <p className="runtime-pause-strip__message">{message}</p>
          </div>
          <div className="runtime-pause-strip__actions">
            <button
              className="runtime-pause-strip__button runtime-pause-strip__button--primary"
              disabled={pointerCapturePending}
              onClick={onResume}
              type="button"
            >
              {primaryLabel}
            </button>
            <button
              className="runtime-pause-strip__button"
              aria-pressed={showControls}
              onClick={() => setShowControls((current) => !current)}
              type="button"
            >
              {showControls ? "Hide Controls" : "Tune Controls"}
            </button>
            <button
              className="runtime-pause-strip__button"
              onClick={onShowRules}
              type="button"
            >
              Rules / Shortcuts
            </button>
            <button
              className="runtime-pause-strip__button"
              onClick={onReturnToMenu}
              type="button"
            >
              Menu
            </button>
          </div>
        </div>
        <div
          className={`runtime-pause-strip__body ${
            showControls
              ? "runtime-pause-strip__body--with-controls"
              : "runtime-pause-strip__body--commands-only"
          }`}
        >
          <div className="runtime-pause-strip__commands-shell">
            <div className="runtime-pause-strip__section-head">
              <p className="runtime-pause-strip__label">Arena Shortcuts</p>
              <p className="runtime-pause-strip__meta">
                Quick reference while the mouse is free.
              </p>
            </div>
            <ShortcutLegend
              bindings={getPauseShortcutBindings()}
              className="runtime-pause-strip__commands"
              variant="pause"
            />
          </div>
          <div className="runtime-pause-strip__sidebar">
            <div className="runtime-pause-strip__radio-shell">
              <div className="runtime-pause-strip__section-head">
                <p className="runtime-pause-strip__label">Chicken Radio</p>
                <p className="runtime-pause-strip__meta">
                  Same tuner as the home menu.
                </p>
              </div>
              {chickenRadioControl}
            </div>
            {showControls && (
              <div className="runtime-pause-strip__controls-shell">
                <div className="runtime-pause-strip__section-head">
                  <p className="runtime-pause-strip__label">Aim Setup</p>
                  <p className="runtime-pause-strip__meta">
                    Adjust camera feel before jumping back in.
                  </p>
                </div>
                <RuntimeControlsSettings
                  onReset={onRuntimeControlSettingsReset}
                  onSettingsChange={onRuntimeControlSettingsChange}
                  settings={runtimeControlSettings}
                  variant="pause"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
