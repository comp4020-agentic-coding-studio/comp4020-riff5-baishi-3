// Pure game rules, kept free of the DOM/canvas so they're testable in
// isolation (spec/crit-5.test.ts) and reusable from main.ts's render loop.

export type Hue = "a" | "b";

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

export interface Player extends Circle {
  hue: Hue;
}

export interface Obstacle extends Circle {
  hue: Hue;
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  return dx * dx + dy * dy < r * r;
}

// The player's colour is fixed (hue "a", never swappable) so the two hues
// split into a fixed hazard and a fixed bonus rather than a relative match:
// hue "b" (poop) costs a life on touch, hue "a" (banana) scores points (the
// falling heart pickup below is the only way to heal). No overlap is always
// safe either way.
export function isHazardTouch(player: Player, obstacle: Obstacle): boolean {
  return circlesOverlap(player, obstacle) && obstacle.hue === "b";
}

export function isBonusTouch(player: Player, obstacle: Obstacle): boolean {
  return circlesOverlap(player, obstacle) && obstacle.hue === "a";
}

export const BANANA_SCORE_BONUS = 100;

// Poop spawns more often and larger than banana, ~1.2x on each axis, to keep
// the now-purely-punishing hazard from fading into the background next to a
// banana that only scores points.
export const POOP_SPAWN_CHANCE = 0.6;
export const POOP_RADIUS_MULTIPLIER = 1.2;

// Obstacles fall faster and spawn more often the longer a round runs, so the
// opening seconds are forgiving and the difficulty caps out fast enough that
// the five-minute mark is a sustained skill test, not a slow ramp.
export function fallSpeed(elapsedSeconds: number): number {
  return 160 + Math.min(elapsedSeconds * 8, 260);
}

export const STARTING_LIVES = 3;

export function loseLife(lives: number): number {
  return Math.max(0, lives - 1);
}

export function gainLife(lives: number): number {
  return Math.min(STARTING_LIVES, lives + 1);
}

export function isOutOfLives(lives: number): boolean {
  return lives <= 0;
}

// A green pickup, falling like an obstacle but hue-independent: touching it
// with any player hue heals one life, capped at STARTING_LIVES.
export type Pickup = Circle;

export function isPickupCaught(player: Player, pickup: Pickup): boolean {
  return circlesOverlap(player, pickup);
}

export function pickupSpawnIntervalMs(): number {
  return 15000;
}

export function spawnIntervalMs(elapsedSeconds: number): number {
  return Math.max(1100 - elapsedSeconds * 22, 380);
}

// A giant final ball spawns once the round has run long enough; catching it
// (any hue — it's the finish line, not another obstacle) ends the game as a
// win instead of a loss.
export const FINAL_BALL_TIME_SECONDS = 45;
export const FINAL_BALL_RADIUS_MULTIPLIER = 1.5;

// Missing it isn't a soft reset — the next chance is held back this long so a
// miss actually costs the player time, not just a blink-and-it's-back retry.
export const FINAL_BALL_RETRY_DELAY_MS = 6000;

export function isFinalBallCaught(player: Player, finalBall: Circle): boolean {
  return circlesOverlap(player, finalBall);
}
