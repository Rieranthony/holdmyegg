import { Suspense, lazy } from "react";
import type { ComponentProps } from "react";

const loadGameCanvasModule = () => import("./GameCanvas");
const GameCanvas = lazy(async () => {
  const module = await loadGameCanvasModule();
  return {
    default: module.GameCanvas
  };
});

export function preloadGameCanvas() {
  void loadGameCanvasModule();
}

function CanvasLoadingState({ label }: { label: string }) {
  return (
    <div className="canvas-loading-shell">
      <div className="canvas-loading-card">
        <p className="panel-kicker">Renderer</p>
        <h2>{label}</h2>
        <p className="stage-copy">Preparing the batched Three.js scene and simulation view.</p>
      </div>
    </div>
  );
}

type GameCanvasBoundaryProps = ComponentProps<typeof GameCanvas> & {
  loadingLabel: string;
};

export function GameCanvasBoundary({ loadingLabel, ...props }: GameCanvasBoundaryProps) {
  return (
    <Suspense fallback={<CanvasLoadingState label={loadingLabel} />}>
      <GameCanvas {...props} />
    </Suspense>
  );
}
