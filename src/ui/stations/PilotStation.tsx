import { GameCanvas } from '@/components/canvas/GameCanvas'
import { HUD } from '@/components/hud/HUD'

export function PilotStation() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <GameCanvas />
      <HUD />
    </div>
  )
}
