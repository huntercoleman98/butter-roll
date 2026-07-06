import { useRef } from 'react'
import MapCanvas from '../components/MapCanvas'
import DiceOverlay from '../components/DiceOverlay'
import { useGameSocket, type DiceRollResult } from '../hooks/useGameSocket'
import '../App.css'

export default function Viewer() {
  const { pages, presentedPageId, arrowOverlay, radiusCircle, ping, viewportSync, diceRequest, send } = useGameSocket()
  const mapAreaRef = useRef<HTMLDivElement>(null)
  const presentedPage = pages.find(p => p.id === presentedPageId) ?? null

  function handleDiceResult(result: DiceRollResult) {
    send({ type: 'dice_roll_result', ...result })
  }

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
        syncedViewport={viewportSync}
        readOnly
      />
      <DiceOverlay request={diceRequest} onResult={handleDiceResult} />
    </div>
  )
}