import { menuToggleStyle, sideMenuButtonStyle, sideMenuLabelStyle, sideMenuStyle } from '@/app/styles'
import type { MultiplayerStatus } from '@/network/colyseusClient'

interface AppSidebarProps {
  menuOpen: boolean
  onToggleMenu: () => void
  onOpenServerWindow: () => void
  onOpenStarSystemWindow: () => void
  onOpenDebugWindow: () => void
  status: MultiplayerStatus
}

export function AppSidebar({
  menuOpen,
  onToggleMenu,
  onOpenServerWindow,
  onOpenStarSystemWindow,
  onOpenDebugWindow,
  status,
}: AppSidebarProps) {
  return (
    <>
      <button onClick={onToggleMenu} style={menuToggleStyle}>
        {menuOpen ? '<' : '>'}
      </button>

      <div style={sideMenuStyle(menuOpen)}>
        <button onClick={onOpenServerWindow} style={sideMenuButtonStyle}>
          <span>⚙</span>
          <span>Server</span>
        </button>
        <button onClick={onOpenStarSystemWindow} style={sideMenuButtonStyle}>
          <span>✦</span>
          <span>Star System Config</span>
        </button>
        <button onClick={onOpenDebugWindow} style={sideMenuButtonStyle}>
          <span>🧪</span>
          <span>Debug Settings</span>
        </button>
        <span style={sideMenuLabelStyle}>Status: {status}</span>
      </div>
    </>
  )
}
