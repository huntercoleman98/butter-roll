import { useEffect, useState } from 'react'
import { Circle, Image as KonvaImage } from 'react-konva'
import { STATUS_EFFECT_MAP } from '../constants/statusEffects'
import { iconToImage } from '../utils/iconToImage'

const BADGE_SIZE = 18
const ICON_SIZE = 12
export const TOKEN_HALF = 30 // TOKEN_SIZE / 2

interface StatusBadgeProps {
  effectId: string
  index: number
}

export default function StatusBadge({ effectId, index }: StatusBadgeProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const effect = STATUS_EFFECT_MAP.get(effectId)

  useEffect(() => {
    if (!effect) return
    iconToImage(effect.Icon, effectId).then(setImg).catch(console.error)
  }, [effectId, effect])

  if (!effect) return null

  // Position badges along the top of the token, right-aligned.
  // Token group origin = token center. Top-right corner ≈ (+21, -21).
  const cx = TOKEN_HALF - BADGE_SIZE / 2 - index * (BADGE_SIZE + 2)
  const cy = -TOKEN_HALF + BADGE_SIZE / 2

  return (
    <>
      <Circle
        x={cx}
        y={cy}
        radius={BADGE_SIZE / 2}
        fill={effect.badgeColor}
        stroke="white"
        strokeWidth={1}
        listening={false}
      />
      {img && (
        <KonvaImage
          image={img}
          x={cx - ICON_SIZE / 2}
          y={cy - ICON_SIZE / 2}
          width={ICON_SIZE}
          height={ICON_SIZE}
          listening={false}
        />
      )}
    </>
  )
}
