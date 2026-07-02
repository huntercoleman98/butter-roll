import { useRef } from 'react'
import MapCanvas from '../components/MapCanvas'
import { useGameSocket } from '../hooks/useGameSocket'
import '../App.css'

export default function Viewer() {
  const { pages, presentedPageId, arrowOverlay, radiusCircle, ping } = useGameSocket()
  const mapAreaRef = useRef<HTMLDivElement>(null)
  const presentedPage = pages.find(p => p.id === presentedPageId) ?? null

  return (
    <div className="app">
      <MapCanvas
        mapUrl={presentedPage?.mapUrl ?? null}
        mapSize={presentedPage?.mapSize ?? null}
        tokens={presentedPage?.tokens ?? []}
        fogRects={presentedPage?.fogRects ?? []}
        mapAreaRef={mapAreaRef}
        arrowOverlay={arrowOverlay}
        ping={ping}
        radiusCircle={radiusCircle}
        readOnly
      />
    </div>
  )
}
