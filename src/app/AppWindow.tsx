import type { ReactNode } from 'react'
import { overlayCloseButtonStyle, overlayHeaderStyle, overlayWindowStyle } from '@/app/styles'

interface AppWindowProps {
  title: string
  left: number
  width: number
  onClose: () => void
  scrollable?: boolean
  children: ReactNode
}

export function AppWindow({ title, left, width, onClose, scrollable = false, children }: AppWindowProps) {
  return (
    <div style={overlayWindowStyle(left, width, scrollable)}>
      <div style={overlayHeaderStyle}>
        <strong>{title}</strong>
        <button onClick={onClose} style={overlayCloseButtonStyle}>
          x
        </button>
      </div>
      {children}
    </div>
  )
}
