type RapierModule = typeof import('@dimforge/rapier3d-compat')

let rapierModule: RapierModule | null = null
let initPromise: Promise<RapierModule> | null = null

export function getRapier(): RapierModule | null {
  return rapierModule
}

export async function ensureRapierLoaded(): Promise<RapierModule> {
  if (rapierModule) return rapierModule
  if (!initPromise) {
    initPromise = import('@dimforge/rapier3d-compat').then(async (R) => {
      await R.init()
      rapierModule = R
      return R
    })
  }
  return initPromise
}
