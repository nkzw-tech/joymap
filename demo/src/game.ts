export type GameInput = {
  aimX: number;
  dashPressed: boolean;
  fireHeld: boolean;
  moveX: number;
  moveY: number;
  pulsePressed: boolean;
  resetPressed: boolean;
  shieldHeld: boolean;
  startPressed: boolean;
};

export type GameEvent = 'dash' | 'hit' | 'pulse' | 'shoot' | 'wave';

export type GameSnapshot = {
  dashReady: boolean;
  lives: number;
  mode: 'game-over' | 'paused' | 'playing';
  pulseReady: boolean;
  score: number;
  shield: number;
  wave: number;
};

type Enemy = {
  column: number;
  row: number;
  x: number;
  y: number;
};

type Shot = {
  enemy: boolean;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

type Star = {
  alpha: number;
  size: number;
  x: number;
  y: number;
};

const GAME_HEIGHT = 600;
const GAME_WIDTH = 960;
const PLAYER_Y = 536;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const collides = (a: { x: number; y: number }, b: { x: number; y: number }, radius: number) => {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y < radius * radius;
};

export class SignalStrikeGame {
  readonly height = GAME_HEIGHT;
  readonly width = GAME_WIDTH;

  #dashCooldown = 0;
  #direction = 1;
  #enemies: Array<Enemy> = [];
  #enemyShotTimer = 1;
  #events: Array<GameEvent> = [];
  #fireCooldown = 0;
  #invulnerable = 0;
  #lives = 3;
  #mode: GameSnapshot['mode'] = 'playing';
  #player = { x: GAME_WIDTH / 2, y: PLAYER_Y };
  #pulseCooldown = 0;
  #random: () => number;
  #score = 0;
  #shield = 1;
  #shots: Array<Shot> = [];
  #stars: Array<Star> = [];
  #wave = 1;

  constructor(random: () => number = Math.random) {
    this.#random = random;
    this.#stars = Array.from({ length: 90 }, () => ({
      alpha: 0.25 + random() * 0.7,
      size: 0.6 + random() * 1.8,
      x: random() * GAME_WIDTH,
      y: random() * GAME_HEIGHT,
    }));
    this.#spawnWave();
  }

  getSnapshot(): GameSnapshot {
    return {
      dashReady: this.#dashCooldown <= 0,
      lives: this.#lives,
      mode: this.#mode,
      pulseReady: this.#pulseCooldown <= 0,
      score: this.#score,
      shield: this.#shield,
      wave: this.#wave,
    };
  }

  reset() {
    this.#dashCooldown = 0;
    this.#direction = 1;
    this.#enemies = [];
    this.#enemyShotTimer = 1;
    this.#events = [];
    this.#fireCooldown = 0;
    this.#invulnerable = 0;
    this.#lives = 3;
    this.#mode = 'playing';
    this.#player = { x: GAME_WIDTH / 2, y: PLAYER_Y };
    this.#pulseCooldown = 0;
    this.#score = 0;
    this.#shield = 1;
    this.#shots = [];
    this.#wave = 1;
    this.#spawnWave();
  }

  update(delta: number, input: GameInput): Array<GameEvent> {
    this.#events = [];
    const elapsed = Math.min(0.05, Math.max(0, delta));

    if (input.resetPressed) {
      this.reset();
      return this.#events;
    }

    if (input.startPressed) {
      if (this.#mode === 'game-over') {
        this.reset();
      } else {
        this.#mode = this.#mode === 'paused' ? 'playing' : 'paused';
      }
    }

    if (this.#mode !== 'playing') {
      return this.#events;
    }

    this.#fireCooldown = Math.max(0, this.#fireCooldown - elapsed);
    this.#dashCooldown = Math.max(0, this.#dashCooldown - elapsed);
    this.#pulseCooldown = Math.max(0, this.#pulseCooldown - elapsed);
    this.#invulnerable = Math.max(0, this.#invulnerable - elapsed);
    this.#shield = clamp(this.#shield + (input.shieldHeld ? -0.38 : 0.16) * elapsed, 0, 1);

    const moveLength = Math.hypot(input.moveX, input.moveY);
    const movementScale = moveLength > 1 ? 1 / moveLength : 1;
    this.#player.x += input.moveX * movementScale * 330 * elapsed;
    this.#player.y += input.moveY * movementScale * 190 * elapsed;

    if (input.dashPressed && this.#dashCooldown <= 0) {
      const dashDirection = Math.abs(input.moveX) > 0.1 ? Math.sign(input.moveX) : 1;
      this.#player.x += dashDirection * 125;
      this.#dashCooldown = 1.25;
      this.#invulnerable = Math.max(this.#invulnerable, 0.22);
      this.#events.push('dash');
    }

    this.#player.x = clamp(this.#player.x, 34, GAME_WIDTH - 34);
    this.#player.y = clamp(this.#player.y, 430, PLAYER_Y);

    if (input.fireHeld && this.#fireCooldown <= 0) {
      this.#shots.push({
        enemy: false,
        vx: clamp(input.aimX, -1, 1) * 230,
        vy: -580,
        x: this.#player.x,
        y: this.#player.y - 24,
      });
      this.#fireCooldown = 0.14;
      this.#events.push('shoot');
    }

    if (input.pulsePressed && this.#pulseCooldown <= 0) {
      this.#pulseCooldown = 4;
      this.#shots = this.#shots.filter(({ enemy }) => !enemy);
      for (let index = this.#enemies.length - 1; index >= 0; index--) {
        const enemy = this.#enemies[index];
        if (Math.hypot(enemy.x - this.#player.x, enemy.y - this.#player.y) < 270) {
          this.#enemies.splice(index, 1);
          this.#score += 25;
        }
      }
      this.#events.push('pulse');
    }

    this.#updateEnemies(elapsed);
    this.#updateShots(elapsed, input.shieldHeld && this.#shield > 0);

    if (this.#enemies.length === 0) {
      this.#wave += 1;
      this.#score += 250;
      this.#shots = this.#shots.filter(({ enemy }) => !enemy);
      this.#spawnWave();
      this.#events.push('wave');
    }

    return this.#events;
  }

  render(context: CanvasRenderingContext2D) {
    context.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.#drawBackground(context);
    this.#drawEnemies(context);
    this.#drawShots(context);
    this.#drawPlayer(context);

    if (this.#mode !== 'playing') {
      context.fillStyle = 'rgba(5, 8, 20, 0.72)';
      context.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      context.textAlign = 'center';
      context.fillStyle = '#f8fafc';
      context.font = '700 42px system-ui';
      context.fillText(this.#mode === 'paused' ? 'PAUSED' : 'SIGNAL LOST', GAME_WIDTH / 2, 270);
      context.fillStyle = '#94a3b8';
      context.font = '500 18px system-ui';
      context.fillText(
        this.#mode === 'paused' ? 'Press Start to continue' : 'Press Start to reconnect',
        GAME_WIDTH / 2,
        310,
      );
    }
  }

  #damagePlayer() {
    if (this.#invulnerable > 0) {
      return;
    }
    this.#lives -= 1;
    this.#invulnerable = 1.4;
    this.#events.push('hit');
    if (this.#lives <= 0) {
      this.#mode = 'game-over';
    }
  }

  #drawBackground(context: CanvasRenderingContext2D) {
    const gradient = context.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    gradient.addColorStop(0, '#060a1d');
    gradient.addColorStop(1, '#11153a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    for (const star of this.#stars) {
      context.globalAlpha = star.alpha;
      context.fillStyle = '#dbeafe';
      context.fillRect(star.x, star.y, star.size, star.size);
    }
    context.globalAlpha = 1;

    context.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    context.lineWidth = 1;
    for (let x = 0; x <= GAME_WIDTH; x += 48) {
      context.beginPath();
      context.moveTo(x, 390);
      context.lineTo(GAME_WIDTH / 2 + (x - GAME_WIDTH / 2) * 1.8, GAME_HEIGHT);
      context.stroke();
    }
    for (let y = 420; y < GAME_HEIGHT; y += 34) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(GAME_WIDTH, y);
      context.stroke();
    }
  }

  #drawEnemies(context: CanvasRenderingContext2D) {
    for (const enemy of this.#enemies) {
      const pulse = Math.sin((enemy.column + enemy.row) * 2 + performance.now() / 180) * 2;
      context.save();
      context.translate(enemy.x, enemy.y + pulse);
      context.fillStyle = enemy.row === 0 ? '#f472b6' : enemy.row === 1 ? '#a78bfa' : '#38bdf8';
      context.shadowBlur = 16;
      context.shadowColor = context.fillStyle;
      context.beginPath();
      context.moveTo(-22, 8);
      context.lineTo(-14, -13);
      context.lineTo(0, -20);
      context.lineTo(14, -13);
      context.lineTo(22, 8);
      context.lineTo(12, 17);
      context.lineTo(5, 8);
      context.lineTo(-5, 8);
      context.lineTo(-12, 17);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = '#060a1d';
      context.fillRect(-10, -6, 5, 5);
      context.fillRect(5, -6, 5, 5);
      context.restore();
    }
  }

  #drawPlayer(context: CanvasRenderingContext2D) {
    const visible = this.#invulnerable <= 0 || Math.floor(this.#invulnerable * 12) % 2 === 0;
    if (!visible) {
      return;
    }

    context.save();
    context.translate(this.#player.x, this.#player.y);
    context.fillStyle = '#22d3ee';
    context.shadowBlur = 20;
    context.shadowColor = '#22d3ee';
    context.beginPath();
    context.moveTo(0, -27);
    context.lineTo(25, 21);
    context.lineTo(7, 14);
    context.lineTo(0, 23);
    context.lineTo(-7, 14);
    context.lineTo(-25, 21);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = '#f8fafc';
    context.beginPath();
    context.moveTo(0, -15);
    context.lineTo(7, 5);
    context.lineTo(-7, 5);
    context.closePath();
    context.fill();

    if (this.#shield < 1) {
      context.strokeStyle = `rgba(167, 139, 250, ${0.25 + this.#shield * 0.65})`;
      context.lineWidth = 4;
      context.shadowBlur = 18;
      context.shadowColor = '#a78bfa';
      context.beginPath();
      context.arc(0, 0, 39, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  #drawShots(context: CanvasRenderingContext2D) {
    for (const shot of this.#shots) {
      context.fillStyle = shot.enemy ? '#fb7185' : '#f8fafc';
      context.shadowBlur = 12;
      context.shadowColor = shot.enemy ? '#fb7185' : '#38bdf8';
      context.fillRect(shot.x - 2, shot.y - 8, 4, 16);
    }
    context.shadowBlur = 0;
  }

  #spawnWave() {
    const columns = 8;
    const rows = Math.min(3 + Math.floor(this.#wave / 3), 5);
    const horizontalGap = 82;
    const startX = (GAME_WIDTH - (columns - 1) * horizontalGap) / 2;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        this.#enemies.push({
          column,
          row,
          x: startX + column * horizontalGap,
          y: 76 + row * 58,
        });
      }
    }
  }

  #updateEnemies(delta: number) {
    const speed = 32 + this.#wave * 7 + (24 - Math.min(24, this.#enemies.length)) * 1.8;
    let shouldDrop = false;
    for (const enemy of this.#enemies) {
      enemy.x += this.#direction * speed * delta;
      if (enemy.x < 34 || enemy.x > GAME_WIDTH - 34) {
        shouldDrop = true;
      }
    }

    if (shouldDrop) {
      this.#direction *= -1;
      for (const enemy of this.#enemies) {
        enemy.x = clamp(enemy.x, 34, GAME_WIDTH - 34);
        enemy.y += 18;
        if (enemy.y > 470) {
          this.#damagePlayer();
          enemy.y = 80;
        }
      }
    }

    this.#enemyShotTimer -= delta;
    if (this.#enemyShotTimer <= 0 && this.#enemies.length > 0) {
      const shooter = this.#enemies[Math.floor(this.#random() * this.#enemies.length)];
      this.#shots.push({
        enemy: true,
        vx: 0,
        vy: 210 + this.#wave * 12,
        x: shooter.x,
        y: shooter.y,
      });
      this.#enemyShotTimer = Math.max(0.28, 1.05 - this.#wave * 0.055) * (0.65 + this.#random());
    }
  }

  #updateShots(delta: number, shieldActive: boolean) {
    for (let shotIndex = this.#shots.length - 1; shotIndex >= 0; shotIndex--) {
      const shot = this.#shots[shotIndex];
      shot.x += shot.vx * delta;
      shot.y += shot.vy * delta;

      if (shot.y < -30 || shot.y > GAME_HEIGHT + 30 || shot.x < -30 || shot.x > GAME_WIDTH + 30) {
        this.#shots.splice(shotIndex, 1);
        continue;
      }

      if (shot.enemy) {
        if (collides(shot, this.#player, shieldActive ? 42 : 23)) {
          this.#shots.splice(shotIndex, 1);
          if (!shieldActive) {
            this.#damagePlayer();
          }
        }
        continue;
      }

      for (let enemyIndex = this.#enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
        const enemy = this.#enemies[enemyIndex];
        if (collides(shot, enemy, 25)) {
          this.#shots.splice(shotIndex, 1);
          this.#enemies.splice(enemyIndex, 1);
          this.#score += 10 * (3 - Math.min(enemy.row, 2));
          break;
        }
      }
    }
  }
}
