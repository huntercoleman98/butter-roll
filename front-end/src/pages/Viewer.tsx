import { useRef } from 'react'
import MapCanvas from '../components/MapCanvas'
import { useGameSocket } from '../hooks/useGameSocket'
import '../App.css'

export default function Viewer() {
  const { mapUrl, mapSize, tokens, fogRects } = useGameSocket()
  const mapAreaRef = useRef<HTMLDivElement>(null)

  return (
    <div className="app">
      <MapCanvas
        mapUrl={mapUrl}
        mapSize={mapSize}
        tokens={tokens}
        fogRects={fogRects}
        mapAreaRef={mapAreaRef}
        readOnly
      />
    </div>
  )
}
