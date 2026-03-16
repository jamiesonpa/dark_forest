import type { CSSProperties } from 'react'

export const appRootStyle: CSSProperties = {
  width: '100vw',
  height: '100vh',
  position: 'relative',
  overflow: 'hidden',
}

export const menuToggleStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 10,
  zIndex: 9999,
  width: 32,
  height: 32,
  borderRadius: 6,
  border: '1px solid rgba(160, 170, 200, 0.45)',
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#d6dbf5',
  cursor: 'pointer',
}

export const sideMenuStyle = (menuOpen: boolean): CSSProperties => ({
  position: 'absolute',
  top: 0,
  left: menuOpen ? 0 : -170,
  zIndex: 9998,
  width: 160,
  height: '100%',
  transition: 'left 180ms ease',
  background: 'rgba(0, 0, 0, 0.62)',
  borderRight: '1px solid rgba(160, 170, 200, 0.35)',
  paddingTop: 60,
  paddingLeft: 12,
  paddingRight: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
})

export const sideMenuButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid rgba(160, 170, 200, 0.45)',
  background: 'rgba(10, 10, 12, 0.85)',
  color: '#d6dbf5',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
}

export const sideMenuLabelStyle: CSSProperties = {
  color: '#d6dbf5',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
}

export const overlayWindowStyle = (left: number, width: number, scrollable = false): CSSProperties => ({
  position: 'absolute',
  top: 90,
  left,
  zIndex: 10000,
  width,
  maxHeight: scrollable ? '80vh' : undefined,
  overflowY: scrollable ? 'auto' : undefined,
  borderRadius: 10,
  background: 'rgba(8, 10, 16, 0.95)',
  border: '1px solid rgba(160, 170, 200, 0.5)',
  color: '#d6dbf5',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
  padding: 12,
})

export const overlayHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
}

export const overlayCloseButtonStyle: CSSProperties = {
  borderRadius: 4,
  border: '1px solid rgba(200, 210, 255, 0.35)',
  background: 'rgba(20, 20, 24, 0.9)',
  color: '#f3f4ff',
  cursor: 'pointer',
  width: 24,
  height: 24,
}
