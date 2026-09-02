import { describe, expect, it } from "vitest";
import {
  gainLife,
  isBonusTouch,
  isHazardTouch,
  isOutOfLives,
  loseLife,
  STARTING_LIVES,
  type Obstacle,
  type Player,
} from "../game-logic.ts";

// Riff: the player's colour is fixed (never swappable), so the rule is no
// longer relative to the player's hue. Hue "b" (poop) is a fixed hazard,
// hue "a" (banana) a fixed bonus. No overlap is always safe either way.
describe("isHazardTouch / isBonusTouch", () => {
  const player: Player = { x: 100, y: 100, radius: 20, hue: "a" };

  it("flags an overlapping hue-b obstacle as a hazard", () => {
    const obstacle: Obstacle = { x: 105, y: 100, radius: 20, hue: "b" };
    expect(isHazardTouch(player, obstacle)).toBe(true);
    expect(isBonusTouch(player, obstacle)).toBe(false);
  });

  it("flags an overlapping hue-a obstacle as a bonus", () => {
    const obstacle: Obstacle = { x: 105, y: 100, radius: 20, hue: "a" };
    expect(isBonusTouch(player, obstacle)).toBe(true);
    expect(isHazardTouch(player, obstacle)).toBe(false);
  });

  it("is neither with no overlap, regardless of hue", () => {
    const hazard: Obstacle = { x: 500, y: 500, radius: 20, hue: "b" };
    const bonus: Obstacle = { x: 500, y: 500, radius: 20, hue: "a" };
    expect(isHazardTouch(player, hazard)).toBe(false);
    expect(isBonusTouch(player, bonus)).toBe(false);
  });
});

describe("lives", () => {
  it("starts with three lives", () => {
    expect(STARTING_LIVES).toBe(3);
  });

  it("ends the round once the third life is lost", () => {
    let lives = STARTING_LIVES;
    lives = loseLife(lives);
    expect(isOutOfLives(lives)).toBe(false);
    lives = loseLife(lives);
    expect(isOutOfLives(lives)).toBe(false);
    lives = loseLife(lives);
    expect(isOutOfLives(lives)).toBe(true);
  });

  it("never drops lives below zero", () => {
    expect(loseLife(0)).toBe(0);
  });

  it("never rises above the starting cap", () => {
    expect(gainLife(STARTING_LIVES)).toBe(STARTING_LIVES);
  });
});
