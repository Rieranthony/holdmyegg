import { randomUUID } from "node:crypto";
import { createDefaultArenaMap, type MapDocumentV1 } from "@out-of-bounds/map";
import type {
  ClientControlMessage,
  CountdownState,
  JoinTicket,
  JoinedRoomPlayer,
  JoinedRoomState,
  ReconnectTicket,
  RoomChatMessage,
  RoomLocalOverlayFrame,
  RoomPhase,
  RoomSharedFrame,
  RoomSummary,
  ScoreEntry,
  ScoreState,
  ServerBootstrapFrame,
  ServerControlMessage,
  ServerStateDeltaFrame
} from "@out-of-bounds/netcode";
import {
  clearTransientRuntimeInputFlags,
  createEmptyRuntimeInputCommand,
  decodeRuntimeInputPacket as decodeRuntimeInputPayload,
  decodeClientControlMessage,
  encodeServerControlMessage,
  encodeServerStateMessage,
  mergeRuntimeInputCommand,
  unpackRuntimeInputCommand,
  type RuntimeInputCommand
} from "@out-of-bounds/netcode";
import { OutOfBoundsSimulation } from "@out-of-bounds/sim";
import type {
  GameplayEvent,
  GameplayEventBatch,
  RuntimePlayerState
} from "@out-of-bounds/sim";
import type { CompletedMatchRecord, MatchParticipantRecord, PlayerRepository } from "../lib/playerRepository";
import type { PlaylistMap } from "../lib/maps";
import { getFacehashSeed } from "../lib/avatar";
import { buildTimeoutRanking } from "./ranking";
import { buildCountdownState, buildRoomSummary, getQueuedHumanCount } from "./selectors";

const COUNTDOWN_SECONDS = 20;
const FULL_ROOM_COUNTDOWN_SECONDS = 5;
const MAX_WAIT_MS = 120_000;
const ROUND_DURATION_MS = 5 * 60_000;
const POST_ROUND_MS = 5_000;
const RECONNECT_GRACE_MS = 20_000;
const CHAT_HISTORY_LIMIT = 100;
const CHAT_MESSAGE_LIMIT = 200;
const CHAT_RATE_LIMIT_WINDOW_MS = 10_000;
const CHAT_RATE_LIMIT_COUNT = 5;

export interface RoomSocket {
  send(data: string | ArrayBufferView | ArrayBuffer): unknown;
}

export interface RoomProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ChatRateState {
  sentAt: number[];
}

interface RoomMember {
  userId: string;
  roomPlayerId: string;
  displayName: string;
  avatarSeed: string;
  avatarUrl: string | null;
  joinedAt: string;
  connected: boolean;
  presence: JoinedRoomPlayer["presence"];
  joinMode: "active" | "spectator";
  socket: RoomSocket | null;
  chatRate: ChatRateState;
  reconnectExpiresAt: number | null;
  lastInput: RuntimeInputCommand;
}

interface TicketRecord {
  ticket: string;
  roomPlayerId: string;
  userId: string;
  expiresAt: number;
}

interface RoundMemberStats {
  roomPlayerId: string;
  userId: string;
  displayName: string;
  joinMode: "active" | "waiting" | "spectator";
  joinedAtMs: number;
  eliminatedAtMs: number | null;
  won: boolean;
  placement: number | null;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  ringOuts: number;
}

export interface RoomConfig {
  id: string;
  name: string;
  region: string;
  capacity: number;
  warm: boolean;
  playlist: PlaylistMap[];
  publicServerUrl: string;
}

const cloneDocument = (document: MapDocumentV1): MapDocumentV1 =>
  JSON.parse(JSON.stringify(document)) as MapDocumentV1;

const now = () => Date.now();

const toIso = (value: number) => new Date(value).toISOString();

const coerceText = (value: string) => value.trim().slice(0, CHAT_MESSAGE_LIMIT);

export class Room {
  private readonly members = new Map<string, RoomMember>();
  private readonly joinTickets = new Map<string, TicketRecord>();
  private readonly reconnectTickets = new Map<string, TicketRecord>();
  private readonly chatHistory: RoomChatMessage[] = [];
  private readonly simulation = new OutOfBoundsSimulation();
  private readonly roundStats = new Map<string, RoundMemberStats>();
  private phase: RoomPhase = "waiting";
  private phaseEnteredAt = now();
  private liveStartedAt: number | null = null;
  private countdownEndsAt: number | null = null;
  private playlistIndex = 0;
  private currentMap: PlaylistMap;
  private currentMatchId: string | null = null;
  private lastBroadcastAt = 0;

  constructor(
    private readonly config: RoomConfig,
    private readonly playerRepository: PlayerRepository
  ) {
    this.currentMap = this.config.playlist[0] ?? {
      id: `${config.id}-fallback`,
      document: createDefaultArenaMap()
    };
    this.pushSystemMessage(`Map selected: ${this.currentMap.document.meta.name}`);
  }

  get id() {
    return this.config.id;
  }

  getSummary(): RoomSummary {
    return buildRoomSummary({
      config: this.config,
      currentMap: this.currentMap,
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      members: this.members.values(),
      nowMs: now()
    });
  }

  getJoinedRoomState(): JoinedRoomState {
    return {
      roomId: this.config.id,
      roomName: this.config.name,
      mapId: this.currentMap.id,
      mapName: this.currentMap.document.meta.name,
      region: this.config.region,
      phase: this.phase,
      capacity: this.config.capacity,
      joinable: this.members.size < this.config.capacity,
      countdown: this.getCountdownState(),
      players: [...this.members.values()]
        .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))
        .map((member) => ({
          roomPlayerId: member.roomPlayerId,
          userId: member.userId,
          displayName: member.displayName,
          avatarSeed: member.avatarSeed,
          avatarUrl: member.avatarUrl,
          connected: member.connected,
          presence: member.presence,
          joinedAt: member.joinedAt
        })),
      score: this.getScoreState()
    };
  }

  issueJoinTicket(profile: RoomProfile): JoinTicket {
    const member = this.ensureMember(profile);
    const ticket = this.createTicket(this.joinTickets, member.userId, member.roomPlayerId);

    return {
      ticket: ticket.ticket,
      roomId: this.config.id,
      wsUrl: `${this.config.publicServerUrl.replace(/^http/, "ws")}/ws?ticket=${encodeURIComponent(ticket.ticket)}`,
      room: this.getJoinedRoomState()
    };
  }

  issueReconnectTicket(roomPlayerId: string) {
    const member = this.members.get(roomPlayerId);
    if (!member) {
      return null;
    }

    const ticket = this.createTicket(this.reconnectTickets, member.userId, roomPlayerId);
    return {
      ticket: ticket.ticket,
      roomId: this.config.id,
      expiresAt: toIso(ticket.expiresAt),
      wsUrl: `${this.config.publicServerUrl.replace(/^http/, "ws")}/ws?ticket=${encodeURIComponent(ticket.ticket)}`
    } satisfies ReconnectTicket;
  }

  connect(ticket: string, userId: string, socket: RoomSocket): ServerBootstrapFrame | null {
    const ticketRecord = this.consumeTicket(ticket, userId);
    if (!ticketRecord) {
      return null;
    }

    const member = this.members.get(ticketRecord.roomPlayerId);
    if (!member) {
      return null;
    }

    member.socket = socket;
    member.connected = true;
    member.reconnectExpiresAt = null;
    if (this.phase === "live") {
      member.presence =
        member.joinMode === "spectator" ? "mid_round_spectating" : member.presence === "dead_spectating" ? "dead_spectating" : "alive";
    } else {
      member.presence = "waiting";
      member.joinMode = "active";
    }

    this.pushSystemMessage(`${member.displayName} joined the room.`);
    this.broadcastRoomState();
    return this.createBootstrapFrame(member.roomPlayerId);
  }

  disconnect(roomPlayerId: string) {
    const member = this.members.get(roomPlayerId);
    if (!member) {
      return null;
    }

    member.connected = false;
    member.socket = null;
    member.presence = this.phase === "live" ? "reconnecting" : "waiting";
    member.reconnectExpiresAt = now() + RECONNECT_GRACE_MS;
    this.pushSystemMessage(`${member.displayName} disconnected.`);
    this.broadcastRoomState();
    return this.issueReconnectTicket(roomPlayerId);
  }

  receiveControl(roomPlayerId: string, message: ClientControlMessage) {
    if (message.type !== "chat_send") {
      return;
    }

    const member = this.members.get(roomPlayerId);
    if (!member || !member.connected) {
      return;
    }

    const trimmed = coerceText(message.text);
    if (!trimmed) {
      return;
    }

    const currentTime = now();
    member.chatRate.sentAt = member.chatRate.sentAt.filter(
      (sentAt) => currentTime - sentAt <= CHAT_RATE_LIMIT_WINDOW_MS
    );
    if (member.chatRate.sentAt.length >= CHAT_RATE_LIMIT_COUNT) {
      this.sendControl(member.socket, {
        type: "error",
        code: "chat_rate_limited",
        message: "You are sending messages too quickly."
      });
      return;
    }

    member.chatRate.sentAt.push(currentTime);
    const chatMessage: RoomChatMessage = {
      id: randomUUID(),
      roomId: this.config.id,
      userId: member.userId,
      displayName: member.displayName,
      avatarSeed: member.avatarSeed,
      avatarUrl: member.avatarUrl,
      presence: this.phase === "live" ? member.presence : "waiting",
      system: false,
      text: trimmed,
      createdAt: toIso(currentTime)
    };
    this.pushChatMessage(chatMessage);
  }

  receiveRuntimeInput(roomPlayerId: string, packet: ArrayBuffer | Uint8Array) {
    const member = this.members.get(roomPlayerId);
    if (!member) {
      return;
    }

    const raw = decodeRuntimeInputPayload(packet);
    member.lastInput = mergeRuntimeInputCommand(
      member.lastInput,
      unpackRuntimeInputCommand(raw)
    );
  }

  tick(dtSeconds: number) {
    const currentTime = now();
    this.pruneTickets(this.joinTickets, currentTime);
    this.pruneTickets(this.reconnectTickets, currentTime);
    this.pruneDisconnectedMembers(currentTime);
    this.updatePhase(currentTime);

    if (this.phase === "live") {
      this.stepSimulation(dtSeconds, currentTime);
      if (currentTime - this.lastBroadcastAt >= 50) {
        this.broadcastState();
        this.lastBroadcastAt = currentTime;
      }
    }
  }

  private ensureMember(profile: RoomProfile) {
    const existing = this.members.get(profile.userId);
    if (existing) {
      existing.displayName = profile.displayName;
      existing.avatarUrl = profile.avatarUrl;
      existing.avatarSeed = getFacehashSeed(profile.userId);
      return existing;
    }

    if (this.members.size >= this.config.capacity) {
      throw new Error("Room is full.");
    }

    const member: RoomMember = {
      userId: profile.userId,
      roomPlayerId: profile.userId,
      displayName: profile.displayName,
      avatarSeed: getFacehashSeed(profile.userId),
      avatarUrl: profile.avatarUrl,
      joinedAt: toIso(now()),
      connected: false,
      presence: this.phase === "live" ? "mid_round_spectating" : "waiting",
      joinMode: this.phase === "live" ? "spectator" : "active",
      socket: null,
      chatRate: {
        sentAt: []
      },
      reconnectExpiresAt: null,
      lastInput: createEmptyRuntimeInputCommand()
    };
    this.members.set(member.roomPlayerId, member);
    return member;
  }

  private createTicket(
    store: Map<string, TicketRecord>,
    userId: string,
    roomPlayerId: string
  ) {
    const record: TicketRecord = {
      ticket: randomUUID(),
      roomPlayerId,
      userId,
      expiresAt: now() + 60_000
    };
    store.set(record.ticket, record);
    return record;
  }

  private consumeTicket(ticket: string, userId: string) {
    const joinTicket = this.joinTickets.get(ticket);
    if (joinTicket && joinTicket.userId === userId && joinTicket.expiresAt >= now()) {
      this.joinTickets.delete(ticket);
      return joinTicket;
    }

    const reconnectTicket = this.reconnectTickets.get(ticket);
    if (
      reconnectTicket &&
      reconnectTicket.userId === userId &&
      reconnectTicket.expiresAt >= now()
    ) {
      this.reconnectTickets.delete(ticket);
      return reconnectTicket;
    }

    return null;
  }

  private pruneTickets(store: Map<string, TicketRecord>, currentTime: number) {
    for (const [ticket, record] of store) {
      if (record.expiresAt < currentTime) {
        store.delete(ticket);
      }
    }
  }

  private pruneDisconnectedMembers(currentTime: number) {
    for (const member of this.members.values()) {
      if (
        member.reconnectExpiresAt !== null &&
        member.reconnectExpiresAt < currentTime &&
        this.phase !== "live"
      ) {
        member.reconnectExpiresAt = null;
      }
    }
  }

  private getCountdownState(): CountdownState {
    return buildCountdownState({
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      nowMs: now(),
      activeHumans: getQueuedHumanCount(this.members.values())
    });
  }

  private updatePhase(currentTime: number) {
    const queuedHumans = getQueuedHumanCount(this.members.values());
    if (this.phase === "waiting") {
      if (queuedHumans >= 2) {
        const fullRoom = queuedHumans >= this.config.capacity;
        const waitedLongEnough = currentTime - this.phaseEnteredAt >= MAX_WAIT_MS;
        if (fullRoom || waitedLongEnough || queuedHumans >= 2) {
          this.phase = "countdown";
          this.phaseEnteredAt = currentTime;
          this.countdownEndsAt =
            currentTime + (fullRoom ? FULL_ROOM_COUNTDOWN_SECONDS : COUNTDOWN_SECONDS) * 1000;
          this.pushSystemMessage(
            fullRoom
              ? `Room full. Starting in ${FULL_ROOM_COUNTDOWN_SECONDS}s.`
              : `Countdown started. Match begins in ${COUNTDOWN_SECONDS}s.`
          );
          this.broadcastRoomState();
        }
      }
      return;
    }

    if (this.phase === "countdown") {
      if (queuedHumans < 2) {
        this.phase = "waiting";
        this.phaseEnteredAt = currentTime;
        this.countdownEndsAt = null;
        this.pushSystemMessage("Countdown canceled. Waiting for more players.");
        this.broadcastRoomState();
        return;
      }

      if (queuedHumans >= this.config.capacity && this.countdownEndsAt !== null) {
        this.countdownEndsAt = Math.min(
          this.countdownEndsAt,
          currentTime + FULL_ROOM_COUNTDOWN_SECONDS * 1000
        );
      }

      if (this.countdownEndsAt !== null && currentTime >= this.countdownEndsAt) {
        this.startLiveRound(currentTime);
      }
      return;
    }

    if (this.phase === "post_round" && currentTime - this.phaseEnteredAt >= POST_ROUND_MS) {
      this.phase = "resetting";
      this.phaseEnteredAt = currentTime;
      this.broadcastRoomState();
      this.resetRound(currentTime);
    }
  }

  private startLiveRound(currentTime: number) {
    const participants = [...this.members.values()].filter(
      (member) => member.connected && member.joinMode === "active"
    );
    if (participants.length < 2) {
      this.phase = "waiting";
      this.phaseEnteredAt = currentTime;
      this.countdownEndsAt = null;
      return;
    }

    this.currentMatchId = randomUUID();
    this.liveStartedAt = currentTime;
    this.phase = "live";
    this.phaseEnteredAt = currentTime;
    this.countdownEndsAt = null;
    this.roundStats.clear();
    this.simulation.reset("multiplayer", cloneDocument(this.currentMap.document), {
      humanPlayers: participants.map((member) => ({
        id: member.roomPlayerId,
        name: member.displayName
      })),
      initialSpawnStyle: "sky",
      initialSpawnSeed: participants.length * 17
    });

    for (const member of this.members.values()) {
      member.lastInput = createEmptyRuntimeInputCommand();
      if (participants.some((participant) => participant.roomPlayerId === member.roomPlayerId)) {
        member.presence = "alive";
        member.joinMode = "active";
      } else {
        member.presence = "mid_round_spectating";
        member.joinMode = "spectator";
      }

      this.roundStats.set(member.roomPlayerId, {
        roomPlayerId: member.roomPlayerId,
        userId: member.userId,
        displayName: member.displayName,
        joinMode: member.joinMode === "active" ? "active" : "spectator",
        joinedAtMs: currentTime,
        eliminatedAtMs: member.joinMode === "active" ? null : currentTime,
        won: false,
        placement: null,
        kills: 0,
        deaths: 0,
        damageDealt: 0,
        damageTaken: 0,
        ringOuts: 0
      });
    }

    this.pushSystemMessage("Round started.");
    this.broadcastRoomState();
    this.broadcastState();
  }

  private resetRound(currentTime: number) {
    this.playlistIndex = (this.playlistIndex + 1) % this.config.playlist.length;
    this.currentMap = this.config.playlist[this.playlistIndex] ?? this.currentMap;
    this.currentMatchId = null;
    this.liveStartedAt = null;
    this.phase = "waiting";
    this.phaseEnteredAt = currentTime;
    this.countdownEndsAt = null;
    for (const member of this.members.values()) {
      member.lastInput = createEmptyRuntimeInputCommand();
      member.presence = member.connected ? "waiting" : "waiting";
      member.joinMode = "active";
    }
    this.pushSystemMessage(`Map selected: ${this.currentMap.document.meta.name}`);
    this.pushSystemMessage("Room reset. Waiting for players.");
    this.broadcastRoomState();
    this.broadcastBootstrap();
  }

  private stepSimulation(dtSeconds: number, currentTime: number) {
    const commands: Record<string, RuntimeInputCommand> = {};
    const activeRoomPlayerIds: string[] = [];
    for (const member of this.members.values()) {
      if (member.joinMode === "active") {
        commands[member.roomPlayerId] = member.lastInput;
        activeRoomPlayerIds.push(member.roomPlayerId);
      }
    }
    this.simulation.step(commands, dtSeconds);
    for (const roomPlayerId of activeRoomPlayerIds) {
      const member = this.members.get(roomPlayerId);
      if (!member) {
        continue;
      }

      member.lastInput = {
        ...clearTransientRuntimeInputFlags(member.lastInput)
      };
    }

    const activePlayers = this.simulation
      .getPlayerIds()
      .map((playerId) => this.simulation.getPlayerRuntimeState(playerId))
      .filter((player): player is RuntimePlayerState => player !== null);
    const alivePlayers = activePlayers.filter((player) => player.alive);
    for (const player of activePlayers) {
      const member = this.members.get(player.id);
      if (!member) {
        continue;
      }

      member.presence = player.alive ? "alive" : "dead_spectating";
      const roundStat = this.roundStats.get(player.id);
      if (roundStat && !player.alive && roundStat.eliminatedAtMs === null) {
        roundStat.eliminatedAtMs = currentTime;
      }
    }

    if (this.liveStartedAt !== null && currentTime - this.liveStartedAt >= ROUND_DURATION_MS) {
      void this.finishRound(currentTime, "timeout");
      return;
    }

    if (alivePlayers.length <= 1 && activePlayers.length > 0) {
      void this.finishRound(currentTime, "winner");
    }
  }

  private async finishRound(currentTime: number, outcome: "winner" | "timeout" | "abandoned") {
    if (this.phase !== "live" || !this.liveStartedAt || !this.currentMatchId) {
      return;
    }
    const roundStartedAt = this.liveStartedAt;

    const activePlayers = this.simulation
      .getPlayerIds()
      .map((playerId) => this.simulation.getPlayerRuntimeState(playerId))
      .filter((player): player is RuntimePlayerState => player !== null);
    const ranking =
      outcome === "timeout"
        ? buildTimeoutRanking(activePlayers, this.roundStats.values())
        : this.simulation.getMatchState(null).ranking;

    ranking.forEach((roomPlayerId, index) => {
      const stat = this.roundStats.get(roomPlayerId);
      if (!stat) {
        return;
      }

      stat.placement = index + 1;
      if (index === 0) {
        stat.won = true;
      }
      if (stat.eliminatedAtMs === null) {
        stat.eliminatedAtMs = currentTime;
      }
    });

    const winnerUserId =
      ranking.length > 0
        ? this.roundStats.get(ranking[0])?.userId ?? null
        : null;
    const participants: MatchParticipantRecord[] = [...this.roundStats.values()].map((stat) => ({
      userId: stat.userId,
      roomPlayerId: stat.roomPlayerId,
      displayName: stat.displayName,
      placement: stat.placement,
      won: stat.won,
      joinMode: stat.joinMode,
      kills: stat.kills,
      deaths: stat.deaths,
      damageDealt: stat.damageDealt,
      damageTaken: stat.damageTaken,
      ringOuts: stat.ringOuts,
      survivalMs:
        stat.joinMode === "spectator"
          ? 0
          : Math.max(0, (stat.eliminatedAtMs ?? currentTime) - roundStartedAt)
    }));

    const record: CompletedMatchRecord = {
      id: this.currentMatchId,
      roomId: this.config.id,
      mapId: this.currentMap.id,
      mapName: this.currentMap.document.meta.name,
      region: this.config.region,
      phaseOutcome: outcome,
      startedAt: toIso(roundStartedAt),
      endedAt: toIso(currentTime),
      winnerUserId,
      summaryJson: JSON.stringify({
        ranking,
        outcome
      }),
      participants
    };
    await this.playerRepository.recordCompletedMatch(record);
    this.phase = "post_round";
    this.phaseEnteredAt = currentTime;
    this.pushSystemMessage("Round finished.");
    this.broadcastRoomState();
    this.broadcastState();
  }

  private broadcastRoomState() {
    const control: ServerControlMessage = {
      type: "room_state",
      room: this.getJoinedRoomState()
    };
    const payload = encodeServerControlMessage(control);
    for (const member of this.members.values()) {
      if (member.socket) {
        member.socket.send(payload);
      }
    }
  }

  private createSharedFrame(): RoomSharedFrame {
    if (this.phase !== "live") {
      return {
        tick: 0,
        time: 0,
        mode: "multiplayer",
        players: [],
        eggs: [],
        eggScatterDebris: [],
        voxelBursts: [],
        skyDrops: [],
        fallingClusters: [],
        authoritativeState: {
          tick: 0,
          time: 0,
          mode: "multiplayer",
          localPlayerId: null,
          players: [],
          projectiles: [],
          hazards: {
            fallingClusters: [],
            skyDrops: [],
            eggScatterDebris: []
          },
          stats: {
            terrainRevision: this.currentMap.document.voxels.length
          },
          ranking: []
        },
        terrainDeltaBatch: null,
        gameplayEventBatch: null
      };
    }

    const gameplayEventBatch = this.simulation.consumeGameplayEventBatch();
    if (gameplayEventBatch) {
      this.applyGameplayEvents(gameplayEventBatch);
    }

    return {
      tick: this.simulation.getMatchState(null).tick,
      time: this.simulation.getMatchState(null).time,
      mode: "multiplayer",
      players: this.simulation
        .getPlayerIds()
        .map((playerId) => this.simulation.getPlayerRuntimeState(playerId))
        .filter((player): player is RuntimePlayerState => player !== null),
      eggs: this.simulation
        .getEggIds()
        .map((eggId) => this.simulation.getEggRuntimeState(eggId))
        .filter((egg): egg is NonNullable<ReturnType<typeof this.simulation.getEggRuntimeState>> => egg !== null),
      eggScatterDebris: this.simulation.getEggScatterDebris(),
      voxelBursts: this.simulation.getVoxelBursts(),
      skyDrops: this.simulation.getSkyDrops(),
      fallingClusters: this.simulation.getFallingClusters(),
      authoritativeState: this.simulation.getAuthoritativeMatchState(null),
      terrainDeltaBatch: this.simulation.consumeTerrainDeltaBatch(),
      gameplayEventBatch
    };
  }

  private createLocalOverlay(roomPlayerId: string): RoomLocalOverlayFrame {
    const member = this.members.get(roomPlayerId);
    const focusState = member
      ? this.simulation.getRuntimeInteractionFocusState(
          member.lastInput.targetVoxel,
          member.lastInput.targetNormal,
          roomPlayerId
        )
      : null;
    return {
      localPlayerId: this.phase === "live" && member?.joinMode === "active" ? roomPlayerId : null,
      hudState: this.phase === "live" && member?.joinMode === "active" ? this.simulation.getHudState(roomPlayerId) : null,
      focusState
    };
  }

  private createBootstrapFrame(roomPlayerId: string): ServerBootstrapFrame {
    return {
      kind: "bootstrap",
      room: this.getJoinedRoomState(),
      world: {
        document: cloneDocument(this.currentMap.document),
        terrainRevision:
          this.phase === "live"
            ? this.simulation.getWorld().getTerrainRevision()
            : this.currentMap.document.voxels.length
      },
      sharedFrame: this.createSharedFrame(),
      localOverlay: this.createLocalOverlay(roomPlayerId),
      recentChat: [...this.chatHistory]
    };
  }

  private broadcastState() {
    const sharedFrame = this.createSharedFrame();
    for (const member of this.members.values()) {
      if (!member.socket) {
        continue;
      }

      const payload = encodeServerStateMessage({
        kind: "delta",
        room: this.getJoinedRoomState(),
        sharedFrame,
        localOverlay: this.createLocalOverlay(member.roomPlayerId)
      } satisfies ServerStateDeltaFrame);
      member.socket.send(payload);
    }
  }

  private broadcastBootstrap() {
    for (const member of this.members.values()) {
      if (!member.socket) {
        continue;
      }

      member.socket.send(encodeServerStateMessage(this.createBootstrapFrame(member.roomPlayerId)));
    }
  }

  private sendControl(socket: RoomSocket | null, control: ServerControlMessage) {
    if (!socket) {
      return;
    }

    socket.send(encodeServerControlMessage(control));
  }

  private pushSystemMessage(text: string) {
    this.pushChatMessage({
      id: randomUUID(),
      roomId: this.config.id,
      userId: null,
      displayName: "System",
      avatarSeed: "system",
      avatarUrl: null,
      presence: "system",
      system: true,
      text,
      createdAt: toIso(now())
    });
  }

  private pushChatMessage(message: RoomChatMessage) {
    this.chatHistory.push(message);
    while (this.chatHistory.length > CHAT_HISTORY_LIMIT) {
      this.chatHistory.shift();
    }

    const payload = encodeServerControlMessage({
      type: "chat_message",
      message
    });
    for (const member of this.members.values()) {
      if (member.socket) {
        member.socket.send(payload);
      }
    }
  }

  private getScoreState(): ScoreState {
    const entries: ScoreEntry[] = [...this.members.values()]
      .map((member) => {
        const currentPlayer = this.phase === "live"
          ? this.simulation.getPlayerRuntimeState(member.roomPlayerId)
          : null;
        const stats = this.roundStats.get(member.roomPlayerId);
        return {
          userId: member.userId,
          roomPlayerId: member.roomPlayerId,
          displayName: member.displayName,
          avatarSeed: member.avatarSeed,
          presence: member.presence,
          connected: member.connected,
          wins: stats?.won ? 1 : 0,
          placement: stats?.placement ?? null,
          livesRemaining: currentPlayer?.livesRemaining ?? 0,
          knockouts: stats?.kills ?? 0,
          deaths: stats?.deaths ?? 0,
          damageDealt: stats?.damageDealt ?? 0,
          damageTaken: stats?.damageTaken ?? 0,
          ringOuts: stats?.ringOuts ?? 0,
          survivedMs:
            stats && this.liveStartedAt
              ? Math.max(0, (stats.eliminatedAtMs ?? now()) - this.liveStartedAt)
              : 0
        };
      })
      .sort((left, right) => {
        if ((left.placement ?? Number.MAX_SAFE_INTEGER) !== (right.placement ?? Number.MAX_SAFE_INTEGER)) {
          return (left.placement ?? Number.MAX_SAFE_INTEGER) - (right.placement ?? Number.MAX_SAFE_INTEGER);
        }
        if (left.presence !== right.presence) {
          return left.presence.localeCompare(right.presence);
        }
        return left.displayName.localeCompare(right.displayName);
      });

    return {
      updatedAt: toIso(now()),
      entries
    };
  }

  private applyGameplayEvents(batch: GameplayEventBatch) {
    const projectileOwners = new Map<string, string>();
    for (const player of this.simulation.getAuthoritativeMatchState(null).projectiles) {
      projectileOwners.set(player.id, player.ownerId);
    }

    for (const event of batch.events) {
      if (event.type === "projectile_spawned") {
        projectileOwners.set(event.entityId, event.ownerId);
      }

      if (event.type === "player_damaged") {
        const targetStats = this.roundStats.get(event.playerId);
        if (targetStats) {
          targetStats.damageTaken += 1;
        }

        const sourcePlayerId = this.resolveSourcePlayerId(event, projectileOwners);
        if (sourcePlayerId) {
          const sourceStats = this.roundStats.get(sourcePlayerId);
          if (sourceStats) {
            sourceStats.damageDealt += 1;
          }
        }
      }

      if (event.type === "player_eliminated") {
        const targetStats = this.roundStats.get(event.playerId);
        if (targetStats) {
          targetStats.deaths += 1;
          targetStats.eliminatedAtMs ??= now();
        }

        const sourcePlayerId = this.resolveSourcePlayerId(event, projectileOwners);
        if (sourcePlayerId && sourcePlayerId !== event.playerId) {
          const sourceStats = this.roundStats.get(sourcePlayerId);
          if (sourceStats) {
            sourceStats.kills += 1;
            if (event.sourceKind === "ringOut") {
              sourceStats.ringOuts += 1;
            }
          }
        }
      }
    }
  }

  private resolveSourcePlayerId(
    event: Extract<GameplayEvent, { sourceEntityId: string | null }> | Extract<GameplayEvent, { sourceEntityId: string }>,
    projectileOwners: Map<string, string>
  ) {
    if (!event.sourceEntityId) {
      return null;
    }

    if (this.members.has(event.sourceEntityId)) {
      return event.sourceEntityId;
    }

    return projectileOwners.get(event.sourceEntityId) ?? null;
  }
}
