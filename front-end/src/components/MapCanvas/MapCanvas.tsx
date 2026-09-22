import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import Konva from "konva";
import Token from "../Token";
import FogLayer from "../FogLayer";
import type {
  TokenData,
  FogPoly,
  ArrowOverlay,
  RadiusCircle,
  Ping,
  ViewportSync,
  HexGridConfig,
} from "../../hooks/useGameSocket";
import type { Monster } from "../../types/monster";
import { clientToWorld } from "./canvasMath";
import type { ActiveTool, ToolContext } from "./tools/types";
import { usePanZoom } from "./tools/usePanZoom";
import { useFogTool } from "./tools/useFogTool";
import { useMeasureTool } from "./tools/useMeasureTool";
import { usePing } from "./tools/usePing";
import { useMarqueeSelect } from "./tools/useMarqueeSelect";
import { useTokenDrag } from "./tools/useTokenDrag";
import { useViewportSync } from "./useViewportSync";
import { ArrowOverlay as ArrowOverlayLayer } from "./overlays/ArrowOverlay";
import { RadiusOverlay } from "./overlays/RadiusOverlay";
import { PingOverlay } from "./overlays/PingOverlay";
import { TokenContextMenu } from "./menus/TokenContextMenu";
import { CanvasContextMenu } from "./menus/CanvasContextMenu";
import HexGridOverlay from "./HexGridOverlay";

export type { ActiveTool };

interface MapCanvasProps {
  mapUrl: string | null;
  mapSize: { width: number; height: number } | null;
  tokens: TokenData[];
  selectedTokenIds?: Set<string>;
  onMoveToken?: (id: string, x: number, y: number) => void;
  onSelectionChange?: (ids: Set<string>) => void;
  mapAreaRef: React.RefObject<HTMLDivElement | null>;
  onStageReady?: (stage: Konva.Stage) => void;
  readOnly?: boolean;
  fogPolys?: FogPoly[];
  hexGrid?: HexGridConfig | null;
  /** Draw the red hex-grid overlay (calibration aid); the grid data itself is
   *  always active for hex reveals regardless of this flag. */
  showHexGrid?: boolean;
  tool?: ActiveTool;
  onFogDraw?: (poly: { points: number[] }) => void;
  onFogRemove?: (id: string) => void;
  onDeleteTokens?: (ids: Set<string>) => void;
  onUpdateToken?: (
    ids: Set<string>,
    update: {
      color?: string;
      borderWidth?: number;
      name?: string;
      showName?: boolean;
      public?: boolean;
      monster?: string;
      hp?: number;
      wounds?: number;
      pinned?: boolean;
    },
  ) => void;
  onUpdateTokenStatus?: (
    ids: Set<string>,
    action: "add" | "remove",
    effectId: string,
  ) => void;
  onUpdateTokenTags?: (
    ids: Set<string>,
    action: "add" | "remove",
    tag: string,
  ) => void;
  arrowOverlay?: ArrowOverlay | null;
  onArrowUpdate?: (arrow: ArrowOverlay) => void;
  onArrowClear?: () => void;
  radiusCircle?: RadiusCircle | null;
  onRadiusUpdate?: (circle: RadiusCircle) => void;
  onRadiusClear?: () => void;
  ping?: Ping | null;
  onPing?: (pos: { x: number; y: number }) => void;
  onBringPlayersHere?: (
    worldCenterX: number,
    worldCenterY: number,
    scale: number,
  ) => void;
  syncedViewport?: ViewportSync | null;
  onAddToInitiative?: (tokenIds: Set<string>) => void;
  initiativeTokenId?: string | null;
  onTokenDoubleClick?: (id: string, x: number, y: number) => void;
  monsters?: Monster[];
}

interface ContextMenu {
  x: number;
  y: number;
  tokenId: string;
}

export default function MapCanvas({
  mapUrl,
  mapSize,
  tokens,
  selectedTokenIds,
  onMoveToken,
  onSelectionChange,
  mapAreaRef,
  onStageReady,
  readOnly = false,
  fogPolys = [],
  hexGrid = null,
  showHexGrid = false,
  tool = "select",
  onFogDraw,
  onFogRemove,
  onDeleteTokens,
  onUpdateToken,
  onUpdateTokenStatus,
  onUpdateTokenTags,
  arrowOverlay = null,
  onArrowUpdate,
  onArrowClear,
  radiusCircle = null,
  onRadiusUpdate,
  onRadiusClear,
  ping = null,
  onPing,
  onBringPlayersHere,
  syncedViewport = null,
  onAddToInitiative,
  initiativeTokenId = null,
  onTokenDoubleClick,
  monsters = [],
}: MapCanvasProps) {
  const fogMode =
    tool === "fog-reveal-box"
      ? "reveal"
      : tool === "fog-reveal-poly"
        ? "poly"
        : tool === "fog-hide"
          ? "hide"
          : tool === "fog-reveal-hex" ? "hex" : null;
  const arrowMode = tool === "arrow";
  const radiusMode = tool === "radius";

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // ── Tools ───────────────────────────────────────────────────────────────────
  useViewportSync(stageRef, mapAreaRef, syncedViewport);
  const panZoom = usePanZoom({
    onContextRequest: onBringPlayersHere
      ? (x, y) => setCanvasContextMenu({ x, y })
      : undefined,
  });
  const fog = useFogTool({
    fogMode,
    fogPolys,
    stageRef,
    onFogDraw,
    onFogRemove,
    hexGrid,
  });
  const measure = useMeasureTool({
    tool,
    onArrowUpdate,
    onArrowClear,
    onRadiusUpdate,
    onRadiusClear,
  });
  const ping_ = usePing({ readOnly, tool, onPing });
  const marquee = useMarqueeSelect({ readOnly, tokens, onSelectionChange });
  const tokenDrag = useTokenDrag({
    selectedTokenIds,
    stageRef,
    onSelectionChange,
    onMoveToken,
  });

  // Track container size
  useEffect(() => {
    const el = mapAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [mapAreaRef]);

  // Expose stage to parent for token placement math
  useEffect(() => {
    if (stageRef.current) onStageReady?.(stageRef.current);
  }, [onStageReady]);

  // Load map image
  useEffect(() => {
    if (!mapUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the loaded image is the intended side effect of a mapUrl change (the load below is async)
      setMapImage(null);
      return;
    }
    const img = new window.Image();
    img.src = mapUrl;
    img.onload = () => setMapImage(img);
  }, [mapUrl]);

  // ── Token interaction ────────────────────────────────────────────────────────

  function handleTokenClick(id: string, shift: boolean) {
    if (ping_.consumeSuppressedClick()) return;
    if (!onSelectionChange) return;
    if (shift) {
      const next = new Set(selectedTokenIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    } else {
      onSelectionChange(new Set([id]));
    }
  }

  function handleTokenContextMenu(id: string, x: number, y: number) {
    if (!selectedTokenIds?.has(id)) onSelectionChange?.(new Set([id]));
    setContextMenu({ x, y, tokenId: id });
  }

  // ── Stage mouse dispatch ─────────────────────────────────────────────────────

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current!;
    const targetIsToken = e.target.name() === "token";
    // Right-button pan / canvas context menu
    if (panZoom.onMouseDown(stage, e.evt, targetIsToken)) return;
    if (e.evt.button !== 0) return;
    e.evt.preventDefault();
    const start = clientToWorld(stage, e.evt.clientX, e.evt.clientY);
    const ctx: ToolContext = { stage, evt: e.evt, start, targetIsToken };
    // Priority order (matches the pre-refactor control flow):
    // fog → measure → ping (arms alongside) → marquee.
    if (fog.onMouseDown(ctx)) return;
    if (measure.onMouseDown(ctx)) return;
    ping_.onMouseDown(ctx);
    marquee.onMouseDown(ctx);
  }

  const tokensInteractive = !readOnly && !fogMode && !arrowMode && !radiusMode;
  const fogOpacity = readOnly ? 1 : 0.65;

  return (
    <div
      ref={mapAreaRef}
      className="map-area"
      style={
        arrowMode || radiusMode
          ? { cursor: "crosshair" }
          : fogMode
            ? { cursor: fogMode === "hide" ? "cell" : "crosshair" }
            : undefined
      }
    >
      {!mapUrl && (
        <div className="map-placeholder">Load a map to get started</div>
      )}
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={panZoom.onWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => {
          if (stageRef.current) fog.onMouseMove(stageRef.current, e.evt);
        }}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <Layer listening={false}>
          {mapImage && (
            <KonvaImage
              image={mapImage}
              width={mapSize?.width ?? mapImage.naturalWidth}
              height={mapSize?.height ?? mapImage.naturalHeight}
              listening={false}
            />
          )}
          {showHexGrid && hexGrid && <HexGridOverlay
            hexGrid={hexGrid}
            mapWidth={mapSize?.width ?? mapImage?.naturalWidth ?? 0}
            mapHeight={mapSize?.height ?? mapImage?.naturalHeight ?? 0}
          />}
        </Layer>
        <Layer>
          {tokens.map((t) => (
            <Token
              key={t.id}
              ref={(handle) => tokenDrag.registerHandle(t.id, handle)}
              {...t}
              isSelected={selectedTokenIds?.has(t.id)}
              isOnInitiative={initiativeTokenId === t.id}
              showName={!readOnly || t.showName}
              showHealthbar={!readOnly}
              shakeOnWoundsChange={readOnly}
              draggable={tokensInteractive}
              onClick={tokensInteractive ? handleTokenClick : undefined}
              onDragStart={tokensInteractive ? tokenDrag.onDragStart : undefined}
              onDragMove={tokensInteractive ? tokenDrag.onDragMove : undefined}
              onDragEnd={tokensInteractive ? tokenDrag.onDragEnd : undefined}
              onContextMenu={
                tokensInteractive ? handleTokenContextMenu : undefined
              }
              onDblClick={tokensInteractive ? onTokenDoubleClick : undefined}
            />
          ))}
        </Layer>
        <FogLayer fogPolys={fogPolys} opacity={fogOpacity} />
        {fog.overlay}
        {marquee.overlay}
        {arrowOverlay && <ArrowOverlayLayer arrow={arrowOverlay} />}
        {ping && <PingOverlay ping={ping} />}
        {radiusCircle && <RadiusOverlay circle={radiusCircle} />}
      </Stage>
      {canvasContextMenu && onBringPlayersHere && (
        <CanvasContextMenu
          x={canvasContextMenu.x}
          y={canvasContextMenu.y}
          onClose={() => setCanvasContextMenu(null)}
          onBringPlayersHere={() => {
            const stage = stageRef.current!;
            const scale = stage.scaleX();
            const worldCenterX = (size.width / 2 - stage.x()) / scale;
            const worldCenterY = (size.height / 2 - stage.y()) / scale;
            onBringPlayersHere(worldCenterX, worldCenterY, scale);
          }}
        />
      )}
      {contextMenu && (
        <TokenContextMenu
          key={contextMenu.tokenId}
          x={contextMenu.x}
          y={contextMenu.y}
          tokenId={contextMenu.tokenId}
          tokens={tokens}
          selectedTokenIds={selectedTokenIds}
          monsters={monsters}
          onClose={() => setContextMenu(null)}
          onUpdateToken={onUpdateToken}
          onUpdateTokenStatus={onUpdateTokenStatus}
          onUpdateTokenTags={onUpdateTokenTags}
          onDeleteTokens={onDeleteTokens}
          onAddToInitiative={onAddToInitiative}
        />
      )}
    </div>
  );
}
