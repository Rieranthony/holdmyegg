import { useId } from "react";
import { voxelTexturePalette, voxelTextureRows } from "../game/voxelMaterials";

const matterCubeViewBox = {
  width: 32,
  height: 30
} as const;

const createTexturePixels = (rows: readonly string[]) =>
  rows.flatMap((row, y) =>
    [...row].map((token, x) => ({
      x,
      y,
      color: voxelTexturePalette[token as keyof typeof voxelTexturePalette]
    }))
  );

const cubeTopPixels = createTexturePixels(voxelTextureRows.earthTop);
const cubeSidePixels = createTexturePixels(voxelTextureRows.earthSide);
const cubeBottomPixels = createTexturePixels(voxelTextureRows.earthBottom);

export function MatterCubeIcon({
  className,
  testId
}: {
  className?: string;
  testId?: string;
}) {
  const idBase = useId().replace(/:/g, "");
  const topPatternId = `${idBase}-top`;
  const sidePatternId = `${idBase}-side`;
  const bottomPatternId = `${idBase}-bottom`;

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-testid={testId}
      viewBox={`0 0 ${matterCubeViewBox.width} ${matterCubeViewBox.height}`}
    >
      <defs>
        <pattern
          id={topPatternId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          {cubeTopPixels.map((pixel) => (
            <rect
              key={`top-${pixel.x}-${pixel.y}`}
              x={pixel.x}
              y={pixel.y}
              width="1"
              height="1"
              fill={pixel.color}
            />
          ))}
        </pattern>
        <pattern
          id={sidePatternId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          {cubeSidePixels.map((pixel) => (
            <rect
              key={`side-${pixel.x}-${pixel.y}`}
              x={pixel.x}
              y={pixel.y}
              width="1"
              height="1"
              fill={pixel.color}
            />
          ))}
        </pattern>
        <pattern
          id={bottomPatternId}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          {cubeBottomPixels.map((pixel) => (
            <rect
              key={`bottom-${pixel.x}-${pixel.y}`}
              x={pixel.x}
              y={pixel.y}
              width="1"
              height="1"
              fill={pixel.color}
            />
          ))}
        </pattern>
      </defs>
      <polygon
        points="16,2 28,8 16,14 4,8"
        fill={`url(#${topPatternId})`}
        stroke="#101922"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <polygon
        points="4,8 16,14 16,26 4,20"
        fill={`url(#${bottomPatternId})`}
        stroke="#101922"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <polygon
        points="28,8 16,14 16,26 28,20"
        fill={`url(#${sidePatternId})`}
        stroke="#101922"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <polygon
        points="10,6 15,9 10,12 5,9"
        fill="rgba(255, 255, 255, 0.18)"
      />
    </svg>
  );
}
