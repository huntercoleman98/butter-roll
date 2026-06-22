import { useEffect, useRef } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'

interface TokenProps {
  id: string
  url: string
  x: number
  y: number
  onMove: (id: string, x: number, y: number) => void
  draggable?: boolean
}

const TOKEN_SIZE = 60

export default function Token({ id, url, x, y, onMove, draggable = true }: TokenProps) {
  const imageRef = useRef<Konva.Image>(null)
  const imgEl = useRef<HTMLImageElement | null>(null)
  const xRef = useRef(x)
  const yRef = useRef(y)

  useEffect(() => {
    const img = new window.Image()
    img.src = url
    img.onload = () => {
      imgEl.current = img
      imageRef.current?.image(img)
      imageRef.current?.getLayer()?.batchDraw()
    }
  }, [url])

  useEffect(() => {
    const node = imageRef.current
    if (!node || (xRef.current === x && yRef.current === y)) return
    xRef.current = x
    yRef.current = y
    node.to({ x, y, duration: 0.15, easing: Konva.Easings.EaseOut })
  }, [x, y])

  return (
    <KonvaImage
      ref={imageRef}
      image={imgEl.current ?? undefined}
      x={xRef.current}
      y={yRef.current}
      width={TOKEN_SIZE}
      height={TOKEN_SIZE}
      offsetX={TOKEN_SIZE / 2}
      offsetY={TOKEN_SIZE / 2}
      cornerRadius={TOKEN_SIZE / 2}
      stroke="#c084fc"
      strokeWidth={2}
      shadowColor="rgba(192,132,252,0.6)"
      shadowBlur={8}
      draggable={draggable}
      onDragStart={draggable ? e => { e.target.moveToTop() } : undefined}
      onDragEnd={draggable ? e => {
        xRef.current = e.target.x()
        yRef.current = e.target.y()
        onMove(id, e.target.x(), e.target.y())
      } : undefined}
      listening={draggable}
    />
  )
}
