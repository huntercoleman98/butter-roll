import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Group, Image as KonvaImage, Text, Circle, Rect } from "react-konva";
import Konva from "konva";
import StatusBadge from "./StatusBadge";

export interface TokenHandle {
  setPosition(x: number, y: number): void;
}

interface TokenProps {
  id: string;
  url: string;
  x: number;
  y: number;
  color?: string;
  borderWidth?: number;
  isSelected?: boolean;
  isOnInitiative?: boolean;
  draggable?: boolean;
  statusEffects?: string[];
  name?: string;
  showName?: boolean;
  public?: boolean;
  monster?: string;
  hp?: number;
  wounds?: number;
  showHealthbar?: boolean;
  onClick?: (id: string, shift: boolean) => void;
  onDragStart?: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number) => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  onDblClick?: (id: string, x: number, y: number) => void;
}

export const TOKEN_SIZE = 60;
const BAR_W = 44;
const BAR_H = 6;

const Token = forwardRef<TokenHandle, TokenProps>(function Token(
  {
    id,
    url,
    x,
    y,
    color = "#c084fc",
    borderWidth = 2,
    isSelected,
    isOnInitiative,
    draggable = true,
    statusEffects,
    name,
    showName,
    public: isPublic,
    monster,
    hp,
    wounds,
    showHealthbar,
    onClick,
    onDragStart,
    onDragMove,
    onDragEnd,
    onContextMenu,
    onDblClick,
  },
  ref,
) {
  const groupRef = useRef<Konva.Group>(null);
  const imageRef = useRef<Konva.Image>(null);
  const imgEl = useRef<HTMLImageElement | null>(null);
  const xRef = useRef(x);
  const yRef = useRef(y);

  useImperativeHandle(
    ref,
    () => ({
      setPosition(newX: number, newY: number) {
        xRef.current = newX;
        yRef.current = newY;
        const node = groupRef.current;
        if (node) {
          node.x(newX);
          node.y(newY);
        }
      },
    }),
    [],
  );

  // Rebuild the cached bitmap. Called after any visual change.
  // Position changes don't need a recache — the bitmap moves with the node.
  function recache() {
    const node = imageRef.current;
    if (!node || !imgEl.current) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }

  useEffect(() => {
    const img = new window.Image();
    img.src = url;
    img.onload = () => {
      imgEl.current = img;
      imageRef.current?.image(img);
      recache();
    };
  }, [url]);

  // Recache whenever anything that affects appearance changes.
  useEffect(() => {
    recache();
  }, [isSelected, isOnInitiative, color, borderWidth]);

  useEffect(() => {
    const node = groupRef.current;
    if (!node || (xRef.current === x && yRef.current === y)) return;
    // Commit the logical position immediately; the tween is only visual. If a
    // rapid follow-up move interrupts this tween, xRef/yRef still reflect the
    // true target rather than the stranded mid-flight position — otherwise the
    // guard above would mistake an interrupted token for "already there" and
    // leave it stuck off from its authoritative x/y.
    xRef.current = x;
    yRef.current = y;
    // Own the tween so a follow-up move can interrupt this one from the node's
    // current position. node.to() would stack overlapping tweens that fight
    // over the position each frame, which shows up as jitter.
    const tween = new Konva.Tween({
      node,
      x,
      y,
      duration: 0.15,
      easing: Konva.Easings.EaseOut,
    });
    tween.play();
    return () => tween.destroy();
  }, [x, y]);

  return (
    <Group
      ref={groupRef}
      id={id}
      name="token"
      x={xRef.current}
      y={yRef.current}
      opacity={isPublic ? 1 : 0.35}
      draggable={draggable}
      onClick={
        draggable
          ? (e) => {
              if (e.evt.button === 0) onClick?.(id, e.evt.shiftKey);
            }
          : undefined
      }
      onDragStart={
        draggable
          ? (e) => {
              e.target.moveToTop();
              onDragStart?.(id, e.target.x(), e.target.y());
            }
          : undefined
      }
      onDragMove={
        draggable
          ? (e) => {
              onDragMove?.(id, e.target.x(), e.target.y());
            }
          : undefined
      }
      onDragEnd={
        draggable
          ? (e) => {
              xRef.current = e.target.x();
              yRef.current = e.target.y();
              onDragEnd?.(id, e.target.x(), e.target.y());
            }
          : undefined
      }
      onContextMenu={
        draggable && onContextMenu
          ? (e) => {
              e.evt.preventDefault();
              e.cancelBubble = true;
              onContextMenu(id, e.evt.clientX, e.evt.clientY);
            }
          : undefined
      }
      onDblClick={
        draggable && onDblClick
          ? (e) => {
              if (e.evt.button !== 0) return;
              e.cancelBubble = true;
              onDblClick(id, e.evt.clientX, e.evt.clientY);
            }
          : undefined
      }
      listening={draggable}
    >
      {isOnInitiative && (
        <Circle
          radius={TOKEN_SIZE / 2 + 4}
          stroke="#ef4444"
          strokeWidth={3}
          shadowColor="rgba(239,68,68,0.85)"
          shadowBlur={18}
          shadowForStrokeEnabled
          listening={false}
        />
      )}
      <KonvaImage
        ref={imageRef}
        name="token"
        image={imgEl.current ?? undefined}
        width={TOKEN_SIZE}
        height={TOKEN_SIZE}
        offsetX={TOKEN_SIZE / 2}
        offsetY={TOKEN_SIZE / 2}
        cornerRadius={TOKEN_SIZE / 2}
        stroke={isSelected ? "#facc15" : color}
        strokeWidth={isSelected ? borderWidth + 1 : borderWidth}
        shadowColor={
          isSelected ? "rgba(250,204,21,0.7)" : "rgba(192,132,252,0.6)"
        }
        shadowBlur={isSelected ? 14 : 8}
        shadowForStrokeEnabled={false}
      />
      {statusEffects?.map((effectId, i) => (
        <StatusBadge key={effectId} effectId={effectId} index={i} />
      ))}
      {showName && name && (
        <Text
          text={name}
          x={-60}
          y={TOKEN_SIZE / 2 + 3}
          width={120}
          align="center"
          fontSize={12}
          fontStyle="bold"
          fill="white"
          stroke="black"
          strokeWidth={3}
          fillAfterStrokeEnabled
          listening={false}
          wrap="none"
          ellipsis
        />
      )}
      {showHealthbar && monster && hp != null && hp > 0 && (
        <>
          <Rect
            x={-BAR_W / 2}
            y={-(TOKEN_SIZE / 2) - BAR_H - 6}
            width={BAR_W}
            height={BAR_H}
            fill="rgba(0,0,0,0.6)"
            stroke="rgba(0,0,0,0.85)"
            strokeWidth={1}
            cornerRadius={2}
            listening={false}
          />
          <Rect
            x={-BAR_W / 2}
            y={-(TOKEN_SIZE / 2) - BAR_H - 6}
            width={BAR_W * Math.max(0, Math.min(1, (hp - (wounds ?? 0)) / hp))}
            height={BAR_H}
            fill={(wounds ?? 0) < hp / 2 ? "#22c55e" : "#ef4444"}
            cornerRadius={2}
            listening={false}
          />
        </>
      )}
    </Group>
  );
});

export default Token;
