import type { MutableRefObject } from 'react'
import { multiplayerClient } from '@/network/colyseusClient'
import type { ShipMoveUpdate } from '../../../shared/contracts/multiplayer'

const MOVE_SEND_INTERVAL_MS = 66

export function sendMoveIfDue(
  lastMoveSendMsRef: MutableRefObject<number>,
  payload: ShipMoveUpdate,
  nowMs = performance.now()
) {
  if (!multiplayerClient.isConnected()) return false
  if (nowMs - lastMoveSendMsRef.current < MOVE_SEND_INTERVAL_MS) return false

  multiplayerClient.sendMove(payload)
  lastMoveSendMsRef.current = nowMs
  return true
}
