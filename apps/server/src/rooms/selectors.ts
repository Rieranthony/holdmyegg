import type {
  CountdownState,
  JoinedRoomPlayer,
  RoomPhase,
  RoomSummary
} from "@out-of-bounds/netcode";
import type { PlaylistMap } from "../lib/maps";

export interface RoomSummaryMember {
  connected: boolean;
  joinMode: "active" | "spectator";
  presence: JoinedRoomPlayer["presence"];
}

interface RoomSummaryConfig {
  id: string;
  name: string;
  region: string;
  capacity: number;
  warm: boolean;
}

const isHumanPresence = (presence: JoinedRoomPlayer["presence"]) =>
  presence === "waiting" || presence === "alive" || presence === "reconnecting";

const isSpectatorPresence = (presence: JoinedRoomPlayer["presence"]) =>
  presence === "dead_spectating" || presence === "mid_round_spectating";

export const getQueuedHumanCount = (
  members: Iterable<Pick<RoomSummaryMember, "connected" | "joinMode">>
) =>
  [...members].filter((member) => member.connected && member.joinMode === "active").length;

export const buildCountdownState = ({
  phase,
  countdownEndsAt,
  nowMs,
  activeHumans
}: {
  phase: RoomPhase;
  countdownEndsAt: number | null;
  nowMs: number;
  activeHumans: number;
}): CountdownState => {
  if (phase === "countdown" && countdownEndsAt !== null) {
    const secondsRemaining = Math.max(0, Math.ceil((countdownEndsAt - nowMs) / 1000));
    return {
      active: true,
      startsAt: new Date(countdownEndsAt).toISOString(),
      secondsRemaining,
      reason: `Starting in ${secondsRemaining}s.`
    };
  }

  if (phase === "live") {
    return {
      active: false,
      startsAt: null,
      secondsRemaining: 0,
      reason: "Round live, next join enters as spectator."
    };
  }

  if (activeHumans < 2) {
    const missingPlayers = 2 - activeHumans;
    return {
      active: false,
      startsAt: null,
      secondsRemaining: 0,
      reason: `Waiting for ${missingPlayers} more player${missingPlayers === 1 ? "" : "s"}.`
    };
  }

  return {
    active: false,
    startsAt: null,
    secondsRemaining: 0,
    reason: "Waiting for countdown."
  };
};

export const buildRoomSummary = ({
  config,
  currentMap,
  phase,
  countdownEndsAt,
  members,
  nowMs
}: {
  config: RoomSummaryConfig;
  currentMap: PlaylistMap;
  phase: RoomPhase;
  countdownEndsAt: number | null;
  members: Iterable<RoomSummaryMember>;
  nowMs: number;
}): RoomSummary => {
  const joined = [...members];
  const humans = joined.filter((member) => isHumanPresence(member.presence)).length;
  const spectators = joined.filter((member) => isSpectatorPresence(member.presence)).length;
  const connected = joined.filter((member) => member.connected).length;
  const countdown = buildCountdownState({
    phase,
    countdownEndsAt,
    nowMs,
    activeHumans: getQueuedHumanCount(joined)
  });

  return {
    id: config.id,
    name: config.name,
    mapId: currentMap.id,
    mapName: currentMap.document.meta.name,
    region: config.region,
    phase,
    joinable: joined.length < config.capacity,
    humans,
    spectators,
    connected,
    capacity: config.capacity,
    warm: config.warm,
    countdown,
    statusText: countdown.reason
  };
};
