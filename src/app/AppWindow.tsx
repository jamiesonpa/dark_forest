import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
  const [position, setPosition] = useState({ x: left, y: 90 })
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRef.current) return
      setPosition({
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y,
      })
    }

    const stopDragging = () => {
      isDraggingRef.current = false
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [])

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    isDraggingRef.current = true
    dragOffsetRef.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    }
    event.preventDefault()
  }

  return (
    <div style={{ ...overlayWindowStyle(left, width, scrollable), left: position.x, top: position.y }}>
      <div
        style={{ ...overlayHeaderStyle, cursor: 'move', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={handleHeaderPointerDown}
      >
        <strong>{title}</strong>
        <button onClick={onClose} style={overlayCloseButtonStyle}>
          x
        </button>
      </div>
      {children}
    </div>
  )
}
