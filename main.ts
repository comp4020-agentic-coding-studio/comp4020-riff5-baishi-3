import {
  circlesOverlap,
  fallSpeed,
  FINAL_BALL_RADIUS_MULTIPLIER,
  FINAL_BALL_TIME_SECONDS,
  gainLife,
  isFatalCollision,
  isFinalBallCaught,
  isMissedBlue,
  isOutOfLives,
  isPickupCaught,
  loseLife,
  otherHue,
  pickupSpawnIntervalMs,
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
// canvas background.
const HUE_COLOR: Record<Hue, string> = { a: "#38bdf8", b: "#f59e0b" };

function playOnce(src: string): void {
  const audio = new Audio(src);
  audio.volume = 0.5;
  audio.play().catch(() => {});
}
const sfxCatchBlue = "./assets/audio/catch_blue.wav";
const sfxHitOrange = "./assets/audio/hit_orange.wav";
const FIRST_SPAWN_DELAY_MS = 1200;
const MOVE_SPEED = 340; // px/s, keyboard movement
const MAX_DT = 0.05; // clamp so a backgrounded tab can't leap the sim forward

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let width = 0;
let height = 0;
let player: Player;
let swapButton: { x: number; y: number; radius: number };
let obstacles: Obstacle[] = [];
let finalBall: Circle | null = null;
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
  // Top-right, clear of the player's row: sharing the bottom corner with the
  // swap button let a resize clamp the player right on top of it, muddling
  // which circle was "you" — found by playing at the mobile viewport.
  swapButton = { x: width - 34, y: 34, radius: 20 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resetGame() {
  obstacles = [];
  finalBall = null;
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
  const radius = clamp(width * 0.045, 14, 24);
  const hue: Hue = Math.random() < 0.5 ? "a" : "b";
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

function withinSwapButton(x: number, y: number): boolean {
  const dx = x - swapButton.x;
  const dy = y - swapButton.y;
  return dx * dx + dy * dy < (swapButton.radius + 12) ** 2;
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.focus();
  if (state === "gameover" || state === "win") {
    resetGame();
    return;
  }
  const { x, y } = pointFromEvent(event);
  if (withinSwapButton(x, y)) {
    player.hue = otherHue(player.hue);
    return;
  }
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
  } else if (event.key === " " || event.key === "Spacebar") {
    // A toggle, not a hold: the browser's own key auto-repeat would otherwise
    // keep flipping the hue for as long as Space stays physically held, the
    // same repeat-vs-fresh-press distinction already guarded on gameover
    // restart above.
    if (event.repeat) return;
    player.hue = otherHue(player.hue);
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

  if (!finalBall && elapsedSeconds >= FINAL_BALL_TIME_SECONDS) {
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
      // Missed it — try again next lap instead of ending the run.
      finalBall = null;
    }
  }
  const pickupSurvivors: Pickup[] = [];
  for (const pickup of pickups) {
    pickup.y += speed * dt;
    if (isPickupCaught(player, pickup)) {
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

    if (isFatalCollision(player, obstacle)) {
      if (obstacle.hue === "b") playOnce(sfxHitOrange);
      gameOver();
      survivors.push(obstacle);
      continue;
    }
    if (circlesOverlap(player, obstacle)) {
      if (obstacle.hue === "a") playOnce(sfxCatchBlue);
      matchedCount += 1;
      continue; // same-hue match: absorbed, removed from play
    }
    if (obstacle.y - obstacle.radius <= height) {
      survivors.push(obstacle);
      continue;
    }
    // Fell past the player unmatched. Missing a blue (hue "a") obstacle
    // costs a life; missing an amber one is a free pass, same as before.
    if (isMissedBlue(obstacle)) {
      lives = loseLife(lives);
      if (isOutOfLives(lives)) gameOver();
    }
  }
  obstacles = survivors;
  score = Math.floor(elapsedSeconds * 10) + matchedCount * 15;
}

function draw() {
  ctx.fillStyle = "#171b2e";
  ctx.fillRect(0, 0, width, height);

  for (const obstacle of obstacles) {
    ctx.beginPath();
    ctx.fillStyle = HUE_COLOR[obstacle.hue];
    ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const pickup of pickups) {
    ctx.beginPath();
    ctx.fillStyle = "#4ade80";
    ctx.arc(pickup.x, pickup.y, pickup.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (finalBall) {
    ctx.beginPath();
    ctx.fillStyle = "#f5f5f7";
    ctx.arc(finalBall.x, finalBall.y, finalBall.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#facc15";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.fillStyle = HUE_COLOR[player.hue];
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#f5f5f7";
  ctx.stroke();

  const pulse = prefersReducedMotion ? 0 : Math.sin(elapsedSeconds * 4) * 2;
  ctx.beginPath();
  ctx.fillStyle = HUE_COLOR[otherHue(player.hue)];
  ctx.arc(swapButton.x, swapButton.y, swapButton.radius + pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "#f5f5f7";
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#f5f5f7";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(`Score: ${score}`, 12, 24);
  ctx.fillText(`Lives: ${lives}`, 12, 46);

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
