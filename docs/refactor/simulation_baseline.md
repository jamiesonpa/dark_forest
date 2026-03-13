# Simulation Baseline (Pre-Reorg)

## Captured Baseline

- `npm run build` succeeds (production bundle generated).
- `npm run lint` currently fails because the repository has no ESLint flat config file (`eslint.config.js`).

## Behavior Invariants To Preserve

- Arrow-key bearing and inclination commands remain continuous and acceleration-based.
- Shift/Control speed trim only applies while MWD is inactive.
- Actual heading, inclination, and speed still ease toward commanded values.
- MWD timing and deactivation remain deterministic and owned by the simulation loop.
- Enemy position integration remains frame-based and heading-driven.
- RWR dynamic bearing updates for enemy-linked contacts remain relative to ownship.
- EW lock/jam interactions continue to downgrade STT to scan when jam effectiveness exceeds lock strength.
- Forward-hemisphere lock pruning still removes non-forward lock entries.
