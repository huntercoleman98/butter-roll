import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Image as KonvaImage } from 'react-konva'
import Konva from 'konva'

export interface TokenHandle {
  setPosition(x: number, y: number): void
}

interface TokenProps {
  id: string
  url: string
  x: number
  y: number
  isSelected?: boolean
  draggable?: boolean
  onClick?: (id: string, shift: boolean) => void
  onDragStart?: (id: string, x: number, y: number) => void
  onDragMove?: (id: string, x: number, y: number) => void
  onDragEnd?: (id: string, x: number, y: number) => void
}

const TOKEN_SIZE = 60

const Token = forwardRef<TokenHandle, TokenProps>(function Token(
  { id, url, x, y, isSelected, draggable = true, onClick, onDragStart, onDragMove, onDragEnd },
  ref,
) {
  const imageRef = useRef<Konva.Image>(null)
  const imgEl = useRef<HTMLImageElement | null>(null)
  const xRef = useRef(x)
  const yRef = useRef(y)

  useImperativeHandle(ref, () => ({
    setPosition(newX: number, newY: number) {
      xRef.current = newX
      yRef.current = newY
      const node = imageRef.current
      if (node) { node.x(newX); node.y(newY) }
    },
  }), [])

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
    node.to({
      x, y,
      duration: 0.15,
      easing: Konva.Easings.EaseOut,
      onFinish: () => { xRef.current = x; yRef.current = y },
    })
  }, [x, y])

  return (
    <KonvaImage
      ref={imageRef}
      id={id}
      name="token"
      image={imgEl.current ?? undefined}
      x={xRef.current}
      y={yRef.current}
      width={TOKEN_SIZE}
      height={TOKEN_SIZE}
      offsetX={TOKEN_SIZE / 2}
      offsetY={TOKEN_SIZE / 2}
      cornerRadius={TOKEN_SIZE / 2}
      stroke={isSelected ? '#facc15' : '#c084fc'}
      strokeWidth={isSelected ? 3 : 2}
      shadowColor={isSelected ? 'rgba(250,204,21,0.7)' : 'rgba(192,132,252,0.6)'}
      shadowBlur={isSelected ? 14 : 8}
      draggable={draggable}
      onClick={draggable ? e => onClick?.(id, e.evt.shiftKey) : undefined}
      onDragStart={draggable ? e => {
        e.target.moveToTop()
        onDragStart?.(id, e.target.x(), e.target.y())
      } : undefined}
      onDragMove={draggable ? e => {
        onDragMove?.(id, e.target.x(), e.target.y())
      } : undefined}
      onDragEnd={draggable ? e => {
        xRef.current = e.target.x()
        yRef.current = e.target.y()
        onDragEnd?.(id, e.target.x(), e.target.y())
      } : undefined}
      listening={draggable}
    />
  )
})

export default Token