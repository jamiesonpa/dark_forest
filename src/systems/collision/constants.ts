/** Coefficient of restitution along the contact normal (0 = inelastic, 1 = elastic). */
export const COLLISION_RESTITUTION = 0.7

/** Fraction of tangential velocity lost on contact (0 = frictionless, 1 = full stop). */
export const COLLISION_TANGENT_FRICTION = 0.15

/** Push-out along obstacle normal after impact (world units). */
export const COLLISION_CONTACT_SKIN = 0.1

/** Minimum velocity (m/s) added along the collision normal so the ship drifts clear. */
export const COLLISION_PUSH_OFF_SPEED = 8

/** Max shape-cast resolution iterations per simulation step. */
export const COLLISION_MAX_CAST_ITERATIONS = 3

/** Subdivide displacement if longer than this (world units per substep). */
export const COLLISION_MAX_DISPLACEMENT_PER_SUBSTEP = 220

import type { TriMeshFlags } from '@dimforge/rapier3d-compat'

/** Rapier TriMeshFlags: DELETE_BAD_TOPOLOGY_TRIANGLES | MERGE_DUPLICATE_VERTICES | DELETE_DEGENERATE_TRIANGLES */
export const TRIMESH_FLAGS = 52 as TriMeshFlags

/**
 * Voxel grid resolution (cells along each AABB axis) used to thin mesh vertices
 * before `convexHull`. Lower = fewer hull faces / coarser collider (max ~n³ samples).
 * If hull creation fails, the registry retries with a finer grid automatically.
 */
export const ASTEROID_HULL_VOXEL_CELLS_PER_AXIS = 3

/**
 * Shrink the convex hull per-instance so the collider sits inside the visual mesh.
 * Convex hulls inflate around concavities (craters, crevices), so this compensates
 * to let ships get visually close before the collision boundary engages.
 */
export const ASTEROID_HULL_SHRINK = 0.85

/** Only the largest fraction of asteroids (by effective radius) receive mesh colliders. */
export const ASTEROID_COLLIDER_SIZE_TOP_FRACTION = 0.3

/** Maximum damage dealt by a collision at or above COLLISION_MAX_DAMAGE_SPEED. */
export const COLLISION_MAX_DAMAGE = 5000

/** Speed (m/s) below which collisions deal no damage (base subwarp speed). */
export const COLLISION_MIN_DAMAGE_SPEED = 215

/** Speed (m/s) at which collision damage reaches COLLISION_MAX_DAMAGE. */
export const COLLISION_MAX_DAMAGE_SPEED = 3000

/** Minimum seconds between successive collision damage applications. */
export const COLLISION_DAMAGE_COOLDOWN = 1.5
