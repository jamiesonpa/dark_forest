const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Salt so primary-star naming does not consume from the main system PRNG stream. */
const PRIMARY_STAR_NAME_SALT = 0xa3c59ac3

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let n = Math.imul(t ^ (t >>> 15), 1 | t)
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n)
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296
  }
}

/** Pattern XN-XNN: uppercase letter, digit, hyphen, letter, two digits. Deterministic per seed. */
export function generatePrimaryStarDesignationFromSeed(seed: number): string {
  const rand = mulberry32((seed ^ PRIMARY_STAR_NAME_SALT) >>> 0)
  const letter = () => LETTERS[Math.floor(rand() * 26)] ?? 'A'
  const digit = () => String(Math.floor(rand() * 10))
  return `${letter()}${digit()}-${letter()}${digit()}${digit()}`
}
