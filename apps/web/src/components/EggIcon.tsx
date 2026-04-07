import { useId } from "react";
import {
  eggIconViewBox,
  eggPartLayout,
  eggTexturePixels,
  eggTextureSize
} from "../game/eggVisualRecipe";

export function EggIcon({
  className,
  testId
}: {
  className?: string;
  testId?: string;
}) {
  const patternId = useId().replace(/:/g, "");

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-testid={testId}
      viewBox={`0 0 ${eggIconViewBox.width} ${eggIconViewBox.height}`}
    >
      <defs>
        <pattern
          height={eggTextureSize}
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={eggTextureSize}
        >
          {eggTexturePixels.map((pixel) => (
            <rect
              fill={pixel.color}
              height="1"
              key={`${pixel.x}-${pixel.y}`}
              width="1"
              x={pixel.x}
              y={pixel.y}
            />
          ))}
        </pattern>
      </defs>
      {eggPartLayout.map((part) => (
        <rect
          fill={`url(#${patternId})`}
          height={part.height}
          key={part.key}
          shapeRendering="crispEdges"
          width={part.width}
          x={part.x}
          y={part.y}
        />
      ))}
    </svg>
  );
}
