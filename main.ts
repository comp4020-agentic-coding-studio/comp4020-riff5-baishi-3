import {
  BANANA_SCORE_BONUS,
  fallSpeed,
  FINAL_BALL_RADIUS_MULTIPLIER,
  FINAL_BALL_RETRY_DELAY_MS,
  FINAL_BALL_TIME_SECONDS,
  gainLife,
  isBonusTouch,
  isFinalBallCaught,
  isHazardTouch,
  isOutOfLives,
  isPickupCaught,
  loseLife,
  pickupSpawnIntervalMs,
  POOP_RADIUS_MULTIPLIER,
  POOP_SPAWN_CHANCE,
  spawnIntervalMs,
  STARTING_LIVES,
  type Circle,
  type Hue,
  type Obstacle,
  type Pickup,
  type Player,
} from "./game-logic.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const announcer = document.querySelector<HTMLElement>("#announcer")!;
const ctx = canvas.getContext("2d")!;

// Sky blue / amber, not the teal/pink first tried: a Machado-2009 CVD
// simulation showed teal and pink collapse to near-identical greys under
// deuteranopia (RGB distance ~27, versus ~222 for typical vision) — this
// pair keeps strong separation under protanopia, deuteranopia and
// tritanopia alike, and both halves contrast near-equally against the
// canvas background. Kept as a fallback fill behind each sprite so a
// slow-loading image still reads as the right hue at a glance.
const HUE_COLOR: Record<Hue, string> = { a: "#38bdf8", b: "#f59e0b" };

function loadSprite(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}
const spriteMonkey = loadSprite("./assets/sprites/monkey.png");
const spriteBanana = loadSprite("./assets/sprites/banana.png");
const spritePoop = loadSprite("./assets/sprites/poop.png");
const spriteHeart = loadSprite("./assets/sprites/heart.png");
const spriteBasket = loadSprite("./assets/sprites/basket.png");
const OBSTACLE_SPRITE: Record<Hue, HTMLImageElement> = { a: spriteBanana, b: spritePoop };

// Draws a sprite centred on (x, y) inside the same 2*radius square the old
// flat-colour circle filled, so the circle-based hitbox in game-logic.ts
// keeps matching what's on screen. Falls back to the flat hue circle until
// the image finishes loading, rather than drawing nothing.
function drawSprite(img: HTMLImageElement, x: number, y: number, radius: number, fallbackColor: string): void {
  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    ctx.beginPath();
    ctx.fillStyle = fallbackColor;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function playOnce(src: string): void {
  const audio = new Audio(src);
  audio.volume = 0.5;
  audio.play().catch(() => {});
}
const sfxCatchBlue = "./assets/audio/catch_blue.wav";
const sfxHitOrange = "./assets/audio/hit_orange.wav";
const sfxHealPickup = "./assets/audio/heal_pickup.wav";
const sfxWinFanfare = "./assets/audio/win_fanfare.wav";

const bgm = new Audio("./assets/audio/bgm_jungle.ogg");
bgm.loop = true;
bgm.volume = 0.35;
let bgmStarted = false;
let bgmMuted = false;

function startBgm(): void {
  if (bgmStarted) return;
  bgmStarted = true;
  bgm.play().catch(() => {});
}
// Autoplay is blocked before any user gesture, so the first pointerdown or
// keydown anywhere on the page (not just in-game ones) is what starts it ---
// capture phase so it fires even if the specific handler below returns early.
window.addEventListener("pointerdown", startBgm, { once: true, capture: true });
window.addEventListener("keydown", startBgm, { once: true, capture: true });

function toggleBgmMute(): void {
  bgmMuted = !bgmMuted;
  bgm.muted = bgmMuted;
  muteBtn.textContent = bgmMuted ? "🔇" : "🔊";
}
const muteBtn = document.createElement("button");
muteBtn.textContent = "🔊";
muteBtn.setAttribute("aria-label", "Mute background music");
muteBtn.style.position = "absolute";
muteBtn.style.top = "8px";
muteBtn.style.right = "8px";
muteBtn.style.zIndex = "10";
muteBtn.style.border = "none";
muteBtn.style.borderRadius = "6px";
muteBtn.style.padding = "4px 8px";
muteBtn.style.cursor = "pointer";
muteBtn.style.background = "rgba(15, 18, 32, 0.6)";
muteBtn.addEventListener("click", toggleBgmMute);
canvas.parentElement?.appendChild(muteBtn);
const FIRST_SPAWN_DELAY_MS = 1200;
const MOVE_SPEED = 340; // px/s, keyboard movement
const MAX_DT = 0.05; // clamp so a backgrounded tab can't leap the sim forward

let width = 0;
let height = 0;
let player: Player;
let obstacles: Obstacle[] = [];
let finalBall: Circle | null = null;
let finalBallCooldownMs = 0;
let pickups: Pickup[] = [];
let state: "playing" | "gameover" | "win" = "playing";
let elapsedSeconds = 0;
let matchedCount = 0;
let score = 0;
let lives = STARTING_LIVES;
let spawnTimer = FIRST_SPAWN_DELAY_MS;
let pickupTimer = pickupSpawnIntervalMs();
let lastTime: number | null = null;
let draggingPointerId: number | null = null;
const pressed = new Set<string>();

function resize() {
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const radius = clamp(width * 0.045, 14, 24);
  if (!player) {
    player = { x: width / 2, y: 0, radius, hue: "a" };
  } else {
    player.radius = radius;
    player.x = clamp(player.x, radius, width - radius);
  }
  player.y = height - radius - 24;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resetGame() {
  obstacles = [];
  finalBall = null;
  finalBallCooldownMs = 0;
  pickups = [];
  state = "playing";
  elapsedSeconds = 0;
  matchedCount = 0;
  score = 0;
  lives = STARTING_LIVES;
  spawnTimer = FIRST_SPAWN_DELAY_MS;
  pickupTimer = pickupSpawnIntervalMs();
  player.hue = "a";
  player.x = width / 2;
  announcer.textContent = "";
}

function spawnObstacle() {
  const baseRadius = clamp(width * 0.045, 14, 24);
  const hue: Hue = Math.random() < POOP_SPAWN_CHANCE ? "b" : "a";
  const radius = hue === "b" ? baseRadius * POOP_RADIUS_MULTIPLIER : baseRadius;
  obstacles.push({
    x: clamp(Math.random() * width, radius, width - radius),
    y: -radius,
    radius,
    hue,
  });
}

function spawnPickup() {
  const radius = clamp(width * 0.045, 14, 24);
  pickups.push({
    x: clamp(Math.random() * width, radius, width - radius),
    y: -radius,
    radius,
  });
}

function pointFromEvent(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.focus();
  if (state === "gameover" || state === "win") {
    resetGame();
    return;
  }
  const { x, y } = pointFromEvent(event);
  // Keyed by pointerId, not a shared flag: an incidental second touch (a
  // palm edge, a bracing finger) lifting off must not stop the pointer
  // that's actually dragging --- found by simulating two independent
  // pointer identities and watching the first one's still-held drag go
  // unresponsive the instant the second one released.
  if (draggingPointerId !== null) return;
  draggingPointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  player.x = clamp(x, player.radius, width - player.radius);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== draggingPointerId) return;
  const { x } = pointFromEvent(event);
  player.x = clamp(x, player.radius, width - player.radius);
});

function endDrag(event: PointerEvent) {
  if (event.pointerId !== draggingPointerId) return;
  draggingPointerId = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

window.addEventListener("keydown", (event) => {
  // Space, the arrow keys, Home, End, PageUp and PageDown are all browser
  // scroll keys and the game has no use for any of them, so all six are
  // suppressed unconditionally here rather than only inside the branches
  // below --- Home/End/PageUp/PageDown scrolled the page during ordinary
  // play the same way ArrowUp/ArrowDown once did, confirmed live at a real
  // short viewport, since none of the four has an in-game effect that would
  // otherwise call preventDefault() on them.
  if (
    event.key === " " ||
    event.key === "Spacebar" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "Home" ||
    event.key === "End" ||
    event.key === "PageUp" ||
    event.key === "PageDown"
  ) {
    event.preventDefault();
  }
  if (state === "gameover" || state === "win") {
    // A key held down at the moment of a fatal collision --- the likely case,
    // since dying usually happens mid-dodge --- keeps sending repeat keydowns
    // for as long as it stays physically held. Restarting on those wipes the
    // game-over screen before the player ever sees it; only a genuine fresh
    // keydown (a release-and-repress, or a different key) should restart.
    if (event.repeat) return;
    resetGame();
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
    pressed.add("left");
    event.preventDefault();
  } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
    pressed.add("right");
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") pressed.delete("left");
  if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") pressed.delete("right");
});

// A key held down while the tab loses focus never gets its keyup — clear
// held state so the player doesn't drift on refocus. blur alone misses a
// same-window tab switch (the browser window keeps OS focus, so it never
// blurs, but the document does still hide); visibilitychange catches that
// case too.
function releaseHeldInput() {
  pressed.clear();
  draggingPointerId = null;
}
window.addEventListener("blur", releaseHeldInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseHeldInput();
});

function spawnFinalBall() {
  const radius = clamp(width * 0.045, 14, 24) * FINAL_BALL_RADIUS_MULTIPLIER;
  finalBall = {
    x: clamp(Math.random() * width, radius, width - radius),
    y: -radius,
    radius,
  };
}

function win() {
  playOnce(sfxWinFanfare);
  state = "win";
  draggingPointerId = null;
  announcer.textContent = `You caught the final ball! Final score ${score}.`;
}

function gameOver() {
  state = "gameover";
  // A collision mid-drag leaves the pointer still down with no pointerup to
  // clear it --- without this, pointermove keeps sliding the player under
  // the game-over overlay, found by forcing the collision mid-drag and
  // watching playerX keep tracking the pointer after the round had ended.
  draggingPointerId = null;
  announcer.textContent = `Game over. Final score ${score}.`;
}

function update(dt: number) {
  elapsedSeconds += dt;

  if (draggingPointerId === null) {
    const dir = (pressed.has("right") ? 1 : 0) - (pressed.has("left") ? 1 : 0);
    player.x = clamp(player.x + dir * MOVE_SPEED * dt, player.radius, width - player.radius);
  }

  spawnTimer -= dt * 1000;
  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = spawnIntervalMs(elapsedSeconds);
  }

  pickupTimer -= dt * 1000;
  if (pickupTimer <= 0) {
    spawnPickup();
    pickupTimer = pickupSpawnIntervalMs();
  }

  if (finalBallCooldownMs > 0) {
    finalBallCooldownMs -= dt * 1000;
  }
  if (!finalBall && finalBallCooldownMs <= 0 && elapsedSeconds >= FINAL_BALL_TIME_SECONDS) {
    spawnFinalBall();
  }

  const speed = fallSpeed(elapsedSeconds);

  if (finalBall) {
    finalBall.y += speed * dt;
    if (isFinalBallCaught(player, finalBall)) {
      win();
      return;
    }
    if (finalBall.y - finalBall.radius > height) {
      // Missed it — try again after a cooldown instead of ending the run
      // (or immediately respawning, which made a miss free).
      finalBall = null;
      finalBallCooldownMs = FINAL_BALL_RETRY_DELAY_MS;
    }
  }
  const pickupSurvivors: Pickup[] = [];
  for (const pickup of pickups) {
    pickup.y += speed * dt;
    if (isPickupCaught(player, pickup)) {
      playOnce(sfxHealPickup);
      lives = gainLife(lives);
      continue; // absorbed
    }
    if (pickup.y - pickup.radius <= height) {
      pickupSurvivors.push(pickup);
    }
  }
  pickups = pickupSurvivors;

  const survivors: Obstacle[] = [];
  for (const obstacle of obstacles) {
    obstacle.y += speed * dt;

    if (isHazardTouch(player, obstacle)) {
      playOnce(sfxHitOrange);
      lives = loseLife(lives);
      if (isOutOfLives(lives)) gameOver();
      continue; // consumed on contact either way
    }
    if (isBonusTouch(player, obstacle)) {
      playOnce(sfxCatchBlue);
      matchedCount += 1;
      continue; // consumed on contact, scores points but no longer heals
    }
    if (obstacle.y - obstacle.radius <= height) {
      survivors.push(obstacle);
    }
    // Falling past unmatched is a free pass either way now — only contact
    // with the player has an effect.
  }
  obstacles = survivors;
  score = Math.floor(elapsedSeconds * 10) + matchedCount * BANANA_SCORE_BONUS;
}

// Hand-coded canopy silhouette rather than a sourced image — keeps this
// purely a draw()-time change with no asset/licensing footprint, and reads
// as jungle at a glance: a dusk-canopy sky gradient behind two rows of
// overlapping tree-top bumps (darker/lower = closer, for cheap parallax
// depth), plus a dark floor strip along the bottom.
const JUNGLE_SKY_TOP = "#284d2b";
const JUNGLE_SKY_BOTTOM = "#0b1f0f";
const CANOPY_BACK = "#1c3d22";
const CANOPY_FRONT = "#122b16";
const JUNGLE_FLOOR = "#08150a";

function drawCanopyBand(color: string, topY: number, bumpRadius: number, spacing: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, topY, width, height - topY);
  for (let x = -bumpRadius; x < width + bumpRadius; x += spacing) {
    ctx.beginPath();
    ctx.arc(x, topY, bumpRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawJungleBackground(): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, JUNGLE_SKY_TOP);
  sky.addColorStop(1, JUNGLE_SKY_BOTTOM);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawCanopyBand(CANOPY_BACK, height * 0.18, height * 0.13, height * 0.16);
  drawCanopyBand(CANOPY_FRONT, height * 0.32, height * 0.15, height * 0.2);

  ctx.fillStyle = JUNGLE_FLOOR;
  ctx.fillRect(0, height - Math.max(16, height * 0.06), width, height);
}

function draw() {
  drawJungleBackground();

  for (const obstacle of obstacles) {
    drawSprite(OBSTACLE_SPRITE[obstacle.hue], obstacle.x, obstacle.y, obstacle.radius, HUE_COLOR[obstacle.hue]);
  }

  for (const pickup of pickups) {
    drawSprite(spriteHeart, pickup.x, pickup.y, pickup.radius, "#4ade80");
  }

  if (finalBall) {
    drawSprite(spriteBasket, finalBall.x, finalBall.y, finalBall.radius, "#f5f5f7");
  }

  drawSprite(spriteMonkey, player.x, player.y, player.radius, HUE_COLOR[player.hue]);

  ctx.fillStyle = "#f5f5f7";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(`Score: ${score}`, 12, 24);

  const HEART_HUD_SIZE = 18;
  for (let i = 0; i < lives; i++) {
    if (spriteHeart.complete && spriteHeart.naturalWidth > 0) {
      ctx.drawImage(spriteHeart, 12 + i * (HEART_HUD_SIZE + 2), 30, HEART_HUD_SIZE, HEART_HUD_SIZE);
    } else {
      ctx.fillStyle = "#ef4444";
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillText("♥".repeat(lives), 12, 46);
      break;
    }
  }

  if (state === "gameover") {
    ctx.fillStyle = "rgba(15, 18, 32, 0.75)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f5f5f7";
    ctx.textAlign = "center";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("Game over", width / 2, height / 2 - 16);
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(`Score: ${score}`, width / 2, height / 2 + 16);
    ctx.fillText("↻", width / 2, height / 2 + 56);
    ctx.textAlign = "left";
  }

  if (state === "win") {
    ctx.fillStyle = "rgba(15, 18, 32, 0.75)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#facc15";
    ctx.textAlign = "center";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("You win!", width / 2, height / 2 - 16);
    ctx.fillStyle = "#f5f5f7";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText(`Score: ${score}`, width / 2, height / 2 + 16);
    ctx.fillText("↻", width / 2, height / 2 + 56);
    ctx.textAlign = "left";
  }
}

function loop(timestamp: number) {
  if (lastTime === null) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, MAX_DT);
  lastTime = timestamp;

  if (state === "playing") {
    update(dt);
  }
  draw();
  requestAnimationFrame(loop);
}

resize();
window.addEventListener("resize", resize);
requestAnimationFrame(loop);
