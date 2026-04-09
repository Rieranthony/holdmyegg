import { featherIconViewBox, featherPixelsByTone, type FeatherTone } from "../game/featherVisualRecipe";

export function FeatherIcon({
  className,
  testId,
  tone = "default"
}: {
  className?: string;
  testId?: string;
  tone?: FeatherTone;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-testid={testId}
      viewBox={`0 0 ${featherIconViewBox.width} ${featherIconViewBox.height}`}
    >
      {featherPixelsByTone[tone].map((pixel) => (
        <rect
          fill={pixel.color}
          height="1"
          key={`${pixel.x}-${pixel.y}`}
          shapeRendering="crispEdges"
          width="1"
          x={pixel.x}
          y={pixel.y}
        />
      ))}
    </svg>
  );
}
