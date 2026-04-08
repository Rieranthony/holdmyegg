import { useMemo, useState } from "react";
import type {
  JoinedRoomState,
  RoomChatMessage
} from "@out-of-bounds/netcode";
import { PlayerAvatar } from "./PlayerAvatar";

interface MultiplayerRoomOverlayProps {
  chat: RoomChatMessage[];
  connectionStatus: string;
  localUserId: string | null;
  onChatSend: (text: string) => void;
  onReturnToMenu: () => void;
  room: JoinedRoomState;
}

const presenceLabel = (presence: JoinedRoomState["players"][number]["presence"]) => {
  switch (presence) {
    case "alive":
      return "Alive";
    case "connected":
      return "Connected";
    case "dead_spectating":
      return "Dead spectator";
    case "loading":
      return "Loading";
    case "mid_round_spectating":
      return "Mid-round spectator";
    case "reconnecting":
      return "Reconnecting";
    case "waiting":
      return "Waiting";
  }
};

export function MultiplayerRoomOverlay({
  chat,
  connectionStatus,
  localUserId,
  onChatSend,
  onReturnToMenu,
  room
}: MultiplayerRoomOverlayProps) {
  const [draft, setDraft] = useState("");

  const localPlayer = useMemo(
    () => room.players.find((player) => player.userId === localUserId) ?? null,
    [localUserId, room.players]
  );

  return (
    <div className="multiplayer-overlay">
      <aside className="multiplayer-overlay__panel multiplayer-overlay__panel--left">
        <div className="multiplayer-overlay__header">
          <div>
            <span className="menu-kicker">{room.region}</span>
            <h2>{room.roomName}</h2>
          </div>
          <button
            className="menu-action menu-action--compact"
            onClick={onReturnToMenu}
            type="button"
          >
            Menu
          </button>
        </div>

        <div className="multiplayer-overlay__banner">
          <strong>{room.mapName}</strong>
          <span>{room.countdown.reason}</span>
          <span>
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "reconnecting"
                ? "Reconnecting..."
                : "Disconnected"}
          </span>
        </div>

        <div className="multiplayer-overlay__tips">
          <span>Click the arena to free-fly while waiting or spectating.</span>
          <span>When you are alive, the camera snaps back to your chicken.</span>
        </div>

        {localPlayer && (
          <div className="multiplayer-overlay__local-player">
            <PlayerAvatar
              imageUrl={localPlayer.avatarUrl}
              label={localPlayer.displayName}
              seed={localPlayer.avatarSeed}
              size={44}
            />
            <div>
              <strong>{localPlayer.displayName}</strong>
              <p>{presenceLabel(localPlayer.presence)}</p>
            </div>
          </div>
        )}

        <section className="multiplayer-overlay__section">
          <div className="multiplayer-overlay__section-title">
            <h3>Roster</h3>
            <span>{room.players.length}/{room.capacity}</span>
          </div>
          <div className="multiplayer-roster">
            {room.players.map((player) => (
              <div className="multiplayer-roster__item" key={player.roomPlayerId}>
                <PlayerAvatar
                  imageUrl={player.avatarUrl}
                  label={player.displayName}
                  seed={player.avatarSeed}
                  size={34}
                />
                <div className="multiplayer-roster__copy">
                  <strong>{player.displayName}</strong>
                  <span>{presenceLabel(player.presence)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <aside className="multiplayer-overlay__panel multiplayer-overlay__panel--right">
        <section className="multiplayer-overlay__section">
          <div className="multiplayer-overlay__section-title">
            <h3>Scoreboard</h3>
            <span>{room.phase.toUpperCase()}</span>
          </div>
          <div className="multiplayer-scoreboard">
            {room.score.entries.map((entry) => (
              <div className="multiplayer-scoreboard__row" key={entry.roomPlayerId}>
                <div className="multiplayer-scoreboard__player">
                  <PlayerAvatar
                    label={entry.displayName}
                    seed={entry.avatarSeed}
                    size={28}
                  />
                  <div>
                    <strong>{entry.displayName}</strong>
                    <span>{entry.presence.replaceAll("_", " ")}</span>
                  </div>
                </div>
                <div className="multiplayer-scoreboard__stats">
                  <span>KOs {entry.knockouts}</span>
                  <span>DMG {entry.damageDealt}</span>
                  <span>
                    {entry.placement ? `#${entry.placement}` : "--"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="multiplayer-overlay__section multiplayer-overlay__section--chat">
          <div className="multiplayer-overlay__section-title">
            <h3>Waiting Room Chat</h3>
            <span>{chat.length}</span>
          </div>
          <div className="multiplayer-chat-log">
            {chat.map((message) => (
              <div
                className={`multiplayer-chat-log__message ${message.system ? "multiplayer-chat-log__message--system" : ""}`.trim()}
                key={message.id}
              >
                {!message.system && (
                  <PlayerAvatar
                    imageUrl={message.avatarUrl}
                    label={message.displayName}
                    seed={message.avatarSeed}
                    size={28}
                  />
                )}
                <div className="multiplayer-chat-log__copy">
                  <strong>{message.displayName}</strong>
                  <p>{message.text}</p>
                </div>
              </div>
            ))}
          </div>
          <form
            className="multiplayer-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed) {
                return;
              }

              onChatSend(trimmed);
              setDraft("");
            }}
          >
            <input
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Say something while the room fills..."
              value={draft}
            />
            <button
              className="menu-action menu-action--compact"
              type="submit"
            >
              Send
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}
