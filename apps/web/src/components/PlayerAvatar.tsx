import { Facehash } from "facehash";

interface PlayerAvatarProps {
  imageUrl?: string | null;
  label: string;
  seed: string;
  size?: number;
}

export function PlayerAvatar({
  imageUrl,
  label,
  seed,
  size = 40
}: PlayerAvatarProps) {
  if (imageUrl) {
    return (
      <img
        alt={label}
        className="player-avatar player-avatar--image"
        height={size}
        src={imageUrl}
        width={size}
      />
    );
  }

  return (
    <Facehash
      aria-label={label}
      className="player-avatar"
      intensity3d="medium"
      name={seed}
      showInitial={false}
      size={size}
      variant="gradient"
    />
  );
}
