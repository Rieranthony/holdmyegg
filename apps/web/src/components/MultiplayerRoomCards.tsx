import type { RoomSummary } from "@out-of-bounds/netcode";

interface MultiplayerRoomCardsProps {
  busy: boolean;
  onJoinRoom: (roomId: string) => void;
  onQuickJoin: () => void;
  rooms: RoomSummary[];
  sessionReady: boolean;
}

export function MultiplayerRoomCards({
  busy,
  onJoinRoom,
  onQuickJoin,
  rooms,
  sessionReady
}: MultiplayerRoomCardsProps) {
  return (
    <section className="multiplayer-menu-panel">
      <div className="multiplayer-menu-panel__header">
        <div>
          <span className="menu-kicker">Multiplayer</span>
          <h2>US Rooms</h2>
        </div>
        <button
          className="menu-action menu-action--full menu-action--compact"
          disabled={!sessionReady || busy}
          onClick={onQuickJoin}
          type="button"
        >
          {busy ? "Joining..." : "Quick Join"}
        </button>
      </div>

      <div className="multiplayer-room-list">
        {rooms.length === 0 && (
          <p className="multiplayer-room-list__empty">
            {sessionReady
              ? "No live rooms yet. Try quick join when the first room opens."
              : "Type your name once to unlock live rooms."}
          </p>
        )}

        {rooms.map((room) => (
          <article className="multiplayer-room-card" key={room.id}>
            <div className="multiplayer-room-card__copy">
              <div className="multiplayer-room-card__title-row">
                <h3>{room.name}</h3>
                <span className="multiplayer-room-card__phase">
                  {room.phase.toUpperCase()}
                </span>
              </div>
              <p className="multiplayer-room-card__map">{room.mapName}</p>
              <p className="multiplayer-room-card__status">{room.statusText}</p>
              <div className="multiplayer-room-card__meta">
                <span>{room.humans}/{room.capacity} active</span>
                <span>{room.spectators} spectating</span>
                <span>{room.region}</span>
              </div>
            </div>
            <button
              className="menu-action menu-action--compact"
              disabled={!sessionReady || busy || !room.joinable}
              onClick={() => onJoinRoom(room.id)}
              type="button"
            >
              {room.joinable ? "Join Room" : "Full"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
