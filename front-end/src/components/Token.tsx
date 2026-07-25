import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
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
  shakeOnWoundsChange?: boolean;
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

// Wounds-change shake (used on /view). Tweak these to change the feel.
const SHAKE_DURATION_MS = 300; // total length of the shake
const SHAKE_AMPLITUDE_PX = 4; // max horizontal offset at the start
const SHAKE_OSCILLATIONS = 3; // number of back-and-forth swings before it settles

const Token = forwardRef<TokenHandle, TokenProps>(function Token(
  {
    id,
    url,
    x,
    y,
    color = "#c084fc",
    borderWidth = 4,
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
    shakeOnWoundsChange,
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

  // Position is driven imperatively (mount → tween/drag → setPosition), never as
  // a controlled prop. react-konva re-applies any x/y prop on every render, so a
  // re-render mid-tween (e.g. the reorder when a group of tokens moves) would
  // snap the node to the tween's target and fight the animation — the source of
  // the multi-token jitter. Set the initial position once here instead.
  useLayoutEffect(() => {
    groupRef.current?.position({ x: xRef.current, y: yRef.current });
    // Run once on mount; subsequent moves are handled by the tween effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Shake the token when its wounds change — a "took a hit" cue used only on
  // /view (gated by shakeOnWoundsChange). Animates offsetX rather than x/y so it
  // never fights the imperative position logic above; offset is visual-only and
  // resets to 0 when the animation ends.
  const prevWoundsRef = useRef(wounds);
  const shakeRef = useRef<Konva.Animation | null>(null);
  useEffect(() => {
    const prev = prevWoundsRef.current;
    prevWoundsRef.current = wounds;
    // Only shake when wounds go up (a hit) — not on heals or when unset.
    if (!shakeOnWoundsChange || wounds == null || wounds <= (prev ?? 0)) return;
    const node = groupRef.current;
    const layer = node?.getLayer();
    if (!node || !layer) return;

    shakeRef.current?.stop();
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const t = frame.time / SHAKE_DURATION_MS;
      if (t >= 1) {
        node.offsetX(0);
        anim.stop();
        return;
      }
      // Oscillate horizontally, decaying linearly to 0 by the end.
      const swing = Math.sin(t * SHAKE_OSCILLATIONS * 2 * Math.PI);
      node.offsetX(swing * SHAKE_AMPLITUDE_PX * (1 - t));
    }, layer);
    shakeRef.current = anim;
    anim.start();
  }, [wounds, shakeOnWoundsChange]);

  // Stop any in-flight shake on unmount.
  useEffect(
    () => () => {
      shakeRef.current?.stop();
    },
    [],
  );

  return (
    <Group
      ref={groupRef}
      id={id}
      name="token"
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
