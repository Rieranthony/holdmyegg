import type { MapDocumentV1 } from "@out-of-bounds/map";
import type {
  AuthoritativeMatchState,
  GameplayEventBatch,
  HudState,
  RuntimeInteractionFocusState,
  RuntimeBurningPropState,
  RuntimePlayerState,
  TerrainDeltaBatch
} from "@out-of-bounds/sim";
import type {
  FallingClusterViewState,
  RuntimeEggScatterDebrisState,
  RuntimeEggState,
  RuntimeSkyDropState,
  RuntimeVoxelBurstState
} from "@out-of-bounds/sim";

export type RoomPhase = "waiting" | "countdown" | "live" | "post_round" | "resetting";

export type RoomPlayerPresence =
  | "connected"
  | "loading"
  | "waiting"
  | "alive"
  | "dead_spectating"
  | "mid_round_spectating"
  | "reconnecting";

export interface CountdownState {
  active: boolean;
  startsAt: string | null;
  secondsRemaining: number;
  reason: string;
}

export interface ScoreEntry {
  userId: string;
  roomPlayerId: string;
  displayName: string;
  avatarSeed: string;
  presence: RoomPlayerPresence;
  connected: boolean;
  wins: number;
  placement: number | null;
  livesRemaining: number;
  knockouts: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  ringOuts: number;
  survivedMs: number;
}

export interface ScoreState {
  updatedAt: string;
  entries: ScoreEntry[];
}

export interface PlayerProfileSummary {
  userId: string;
  displayName: string;
  avatarSeed: string;
  avatarUrl: string | null;
}

export interface MatchSummary {
  id: string;
  roomId: string;
  mapName: string;
  phaseOutcome: "winner" | "timeout" | "abandoned";
  startedAt: string;
  endedAt: string;
  winnerUserId: string | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  mapName: string;
  mapId: string;
  region: string;
  phase: RoomPhase;
  joinable: boolean;
  humans: number;
  spectators: number;
  connected: number;
  capacity: number;
  warm: boolean;
  countdown: CountdownState;
  statusText: string;
}

export interface RoomChatMessage {
  id: string;
  roomId: string;
  userId: string | null;
  displayName: string;
  avatarSeed: string;
  avatarUrl: string | null;
  presence: RoomPlayerPresence | "system";
  system: boolean;
  text: string;
  createdAt: string;
}

export interface JoinedRoomPlayer {
  roomPlayerId: string;
  userId: string;
  displayName: string;
  avatarSeed: string;
  avatarUrl: string | null;
  connected: boolean;
  presence: RoomPlayerPresence;
  joinedAt: string;
}

export interface JoinedRoomState {
  roomId: string;
  roomName: string;
  mapId: string;
  mapName: string;
  region: string;
  phase: RoomPhase;
  capacity: number;
  joinable: boolean;
  countdown: CountdownState;
  players: JoinedRoomPlayer[];
  score: ScoreState;
}

export interface JoinTicket {
  ticket: string;
  roomId: string;
  wsUrl: string;
  room: JoinedRoomState;
}

export interface ReconnectTicket {
  ticket: string;
  roomId: string;
  expiresAt: string;
  wsUrl: string;
}

export interface RoomWorldState {
  document: MapDocumentV1;
  terrainRevision: number;
}

export interface RoomSharedFrame {
  tick: number;
  time: number;
  mode: "multiplayer";
  players: RuntimePlayerState[];
  eggs: RuntimeEggState[];
  eggScatterDebris: RuntimeEggScatterDebrisState[];
  burningProps: RuntimeBurningPropState[];
  voxelBursts: RuntimeVoxelBurstState[];
  skyDrops: RuntimeSkyDropState[];
  fallingClusters: FallingClusterViewState[];
  authoritativeState: AuthoritativeMatchState;
  terrainDeltaBatch: TerrainDeltaBatch | null;
  gameplayEventBatch: GameplayEventBatch | null;
}

export interface RoomLocalOverlayFrame {
  localPlayerId: string | null;
  hudState: HudState | null;
  focusState: RuntimeInteractionFocusState | null;
}

export interface ServerBootstrapFrame {
  kind: "bootstrap";
  room: JoinedRoomState;
  world: RoomWorldState;
  sharedFrame: RoomSharedFrame;
  localOverlay: RoomLocalOverlayFrame;
  recentChat: RoomChatMessage[];
}

export interface ServerStateDeltaFrame {
  kind: "delta";
  room: JoinedRoomState;
  sharedFrame: RoomSharedFrame;
  localOverlay: RoomLocalOverlayFrame;
}

export type ClientControlMessage =
  | {
      type: "chat_send";
      text: string;
    }
  | {
      type: "pong";
      at: number;
    };

export type ServerControlMessage =
  | {
      type: "chat_message";
      message: RoomChatMessage;
    }
  | {
      type: "presence_update";
      room: JoinedRoomState;
    }
  | {
      type: "room_state";
      room: JoinedRoomState;
    }
  | {
      type: "reconnect_ticket";
      reconnect: ReconnectTicket;
    }
  | {
      type: "error";
      code: string;
      message: string;
    }
  | {
      type: "ping";
      at: number;
    };

export interface QuickJoinResponse {
  join: JoinTicket;
}

export interface JoinRoomResponse {
  join: JoinTicket;
}

export interface RoomsResponse {
  rooms: RoomSummary[];
}

export interface ProfileStatsSummary {
  totalMatches: number;
  totalWins: number;
  totalKills: number;
  totalDeaths: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalRingOuts: number;
  totalSurvivalMs: number;
}

export interface PlayerProfileResponse {
  profile: PlayerProfileSummary;
  stats: ProfileStatsSummary;
  recentMatches: MatchSummary[];
}

export interface UpdateProfileRequest {
  displayName: string;
}

export const createRuntimeRenderFrame = (
  sharedFrame: RoomSharedFrame,
  localOverlay: RoomLocalOverlayFrame
) => ({
  tick: sharedFrame.tick,
  time: sharedFrame.time,
  mode: sharedFrame.mode,
  localPlayerId: localOverlay.localPlayerId,
  hudState: localOverlay.hudState,
  focusState: localOverlay.focusState,
  authoritative: {
    state: {
      ...sharedFrame.authoritativeState,
      localPlayerId: localOverlay.localPlayerId
    },
    terrainDeltaBatch: sharedFrame.terrainDeltaBatch,
    gameplayEventBatch: sharedFrame.gameplayEventBatch
  },
  players: sharedFrame.players,
  eggs: sharedFrame.eggs,
  eggScatterDebris: sharedFrame.eggScatterDebris,
  burningProps: sharedFrame.burningProps,
  voxelBursts: sharedFrame.voxelBursts,
  skyDrops: sharedFrame.skyDrops,
  fallingClusters: sharedFrame.fallingClusters
});
