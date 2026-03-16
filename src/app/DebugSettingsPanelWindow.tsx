import { AppWindow } from '@/app/AppWindow'
import { DebugSettingsWindow } from '@/components/hud/DebugSettingsWindow'

interface DebugSettingsPanelWindowProps {
  open: boolean
  onClose: () => void
}

export function DebugSettingsPanelWindow({ open, onClose }: DebugSettingsPanelWindowProps) {
  if (!open) return null

  return (
    <AppWindow title="Debug Settings" left={860} width={340} onClose={onClose} scrollable>
      <DebugSettingsWindow />
    </AppWindow>
  )
}
