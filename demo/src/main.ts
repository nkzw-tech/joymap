import { createController, createJoymap, type ButtonResult } from '../../src/index.ts';
import { SignalStrikeGame, type GameEvent, type GameInput } from './game.ts';
import './style.css';

const buttonNames = [
  'A',
  'B',
  'X',
  'Y',
  'L1',
  'R1',
  'L2',
  'R2',
  'select',
  'start',
  'L3',
  'R3',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
  'home',
] as const;

type ButtonName = (typeof buttonNames)[number];

const buttonIndexes: Record<ButtonName, number> = {
  A: 0,
  B: 1,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  dpadUp: 12,
  home: 16,
  L1: 4,
  L2: 6,
  L3: 10,
  R1: 5,
  R2: 7,
  R3: 11,
  select: 8,
  start: 9,
  X: 2,
  Y: 3,
};

const keyBindings: Partial<Record<string, ButtonName>> = {
  Backspace: 'select',
  Enter: 'start',
  KeyC: 'R2',
  KeyE: 'R1',
  KeyF: 'L3',
  KeyG: 'R3',
  KeyH: 'home',
  KeyI: 'Y',
  KeyJ: 'A',
  KeyK: 'B',
  KeyQ: 'L1',
  KeyU: 'X',
  KeyZ: 'L2',
  ShiftLeft: 'B',
  ShiftRight: 'B',
  Space: 'A',
};

const movementBindings: Partial<Record<string, ButtonName>> = {
  ArrowDown: 'dpadDown',
  ArrowLeft: 'dpadLeft',
  ArrowRight: 'dpadRight',
  ArrowUp: 'dpadUp',
  KeyA: 'dpadLeft',
  KeyD: 'dpadRight',
  KeyS: 'dpadDown',
  KeyW: 'dpadUp',
};

const getElement = <ElementType extends HTMLElement>(id: string) => {
  const element = document.querySelector<ElementType>(`#${id}`);
  if (!element) {
    throw new Error(`Missing demo element '#${id}'`);
  }
  return element;
};

const canvas = getElement<HTMLCanvasElement>('game');
const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D is not available.');
}

const connection = getElement('connection');
const connectionLabel = getElement('connection-label');
const lastInput = getElement('last-input');
const leftStickValue = getElement('left-stick-value');
const lives = getElement('lives');
const pollRate = getElement('poll-rate');
const rightStickValue = getElement('right-stick-value');
const score = getElement('score');
const screenStatus = getElement('screen-status');
const shieldValue = getElement('shield-value');
const wave = getElement('wave');
const controlElements = new Map<ButtonName, HTMLButtonElement>();

for (const element of document.querySelectorAll<HTMLButtonElement>('[data-input]')) {
  controlElements.set(element.dataset.input as ButtonName, element);
}

const leftStickElement = controlElements.get('L3')!;
const rightStickElement = controlElements.get('R3')!;
const activeKeys = new Set<string>();
const pointerInputs = new Set<ButtonName>();
const pointerReleaseTimers = new Map<ButtonName, number>();
const previousButtons = new Map<ButtonName, boolean>();

const controller = createController({
  buttonReleaseThreshold: 0.08,
  buttonThreshold: 0.12,
  rescaleSticks: true,
  stickDeadzone: 0.16,
  stickReleaseDeadzone: 0.11,
});

for (const name of buttonNames) {
  controller.setButton(name, [buttonIndexes[name]]);
}
controller.setStick('L', [[0, 1]]);
controller.setStick('R', [[2, 3]]);

const joymap = createJoymap({ autoConnect: true });
joymap.addController(controller);

const game = new SignalStrikeGame();

const shouldPreventDefault = (code: string) => code in keyBindings || code in movementBindings;

window.addEventListener('keydown', (event) => {
  if (shouldPreventDefault(event.code)) {
    event.preventDefault();
  }
  activeKeys.add(event.code);
});

window.addEventListener('keyup', (event) => {
  if (shouldPreventDefault(event.code)) {
    event.preventDefault();
  }
  activeKeys.delete(event.code);
});

window.addEventListener('blur', () => activeKeys.clear());

for (const [inputName, element] of controlElements) {
  const release = () => {
    const releaseTimer = pointerReleaseTimers.get(inputName);
    if (releaseTimer !== undefined) {
      window.clearTimeout(releaseTimer);
    }
    pointerReleaseTimers.set(
      inputName,
      window.setTimeout(() => {
        pointerInputs.delete(inputName);
        pointerReleaseTimers.delete(inputName);
      }, 80),
    );
  };
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const releaseTimer = pointerReleaseTimers.get(inputName);
    if (releaseTimer !== undefined) {
      window.clearTimeout(releaseTimer);
      pointerReleaseTimers.delete(inputName);
    }
    element.setPointerCapture(event.pointerId);
    pointerInputs.add(inputName);
  });
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('lostpointercapture', release);
}

const emptyButton = (): ButtonResult => ({
  justChanged: false,
  pressed: false,
  type: 'button',
  value: 0,
});

const getKeyboardButtons = () => {
  const result = new Set<ButtonName>();
  for (const code of activeKeys) {
    const inputName = keyBindings[code] ?? movementBindings[code];
    if (inputName) {
      result.add(inputName);
    }
  }
  return result;
};

const formatAxis = (value: number) => (Math.abs(value) < 0.005 ? '0.00' : value.toFixed(2));

const setStickPosition = (element: HTMLElement, x: number, y: number) => {
  element.style.setProperty('--stick-x', `${clamp(x, -1, 1) * 11}px`);
  element.style.setProperty('--stick-y', `${clamp(y, -1, 1) * 11}px`);
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const applyRumble = (events: ReadonlyArray<GameEvent>) => {
  if (!controller.isConnected()) {
    return;
  }

  for (const event of events) {
    if (event === 'shoot') {
      controller.addRumble({ duration: 35, weakMagnitude: 0.12 }, 'weapon');
    } else if (event === 'dash') {
      controller.addRumble({ duration: 90, strongMagnitude: 0.32 }, 'movement');
    } else if (event === 'pulse') {
      controller.addRumble(
        [
          { duration: 90, strongMagnitude: 0.72, weakMagnitude: 0.4 },
          45,
          { duration: 120, strongMagnitude: 0.35, weakMagnitude: 0.7 },
        ],
        'pulse',
      );
    } else if (event === 'hit') {
      controller.addRumble({ duration: 260, strongMagnitude: 1, weakMagnitude: 0.75 }, 'damage');
    } else if (event === 'wave') {
      controller.addRumble(
        [{ duration: 80, weakMagnitude: 0.35 }, 60, { duration: 80, weakMagnitude: 0.55 }],
        'wave',
      );
    }
  }
};

let frameCount = 0;
let frameWindowStartedAt = performance.now();
let previousFrameAt = performance.now();

const update = (now: number) => {
  const delta = (now - previousFrameAt) / 1000;
  previousFrameAt = now;
  joymap.poll();

  const connected = controller.isConnected();
  const gamepad = controller.getGamepad();
  const physicalButtons = connected
    ? controller.getButtons(...buttonNames)
    : Object.fromEntries(buttonNames.map((name) => [name, emptyButton()]));
  const keyboardButtons = getKeyboardButtons();
  const currentButtons = new Map<ButtonName, boolean>();
  let newestInput = '';

  for (const inputName of buttonNames) {
    const physical = physicalButtons[inputName] ?? emptyButton();
    const active =
      physical.pressed || pointerInputs.has(inputName) || keyboardButtons.has(inputName);
    currentButtons.set(inputName, active);

    const element = controlElements.get(inputName)!;
    element.classList.toggle('is-active', active);
    element.setAttribute('aria-pressed', String(active));
    if (inputName === 'L2' || inputName === 'R2') {
      element.style.setProperty(
        '--trigger-value',
        String(Math.max(physical.value, active ? 1 : 0)),
      );
    }
    if (active && !previousButtons.get(inputName)) {
      newestInput = inputName;
    }
  }

  const leftStick = connected ? controller.getStick('L') : { value: [0, 0] };
  const rightStick = connected ? controller.getStick('R') : { value: [0, 0] };
  const digitalX = Number(currentButtons.get('dpadRight')) - Number(currentButtons.get('dpadLeft'));
  const digitalY = Number(currentButtons.get('dpadDown')) - Number(currentButtons.get('dpadUp'));
  const moveX = clamp(leftStick.value[0] + digitalX, -1, 1);
  const moveY = clamp(leftStick.value[1] + digitalY, -1, 1);

  setStickPosition(leftStickElement, moveX, moveY);
  setStickPosition(rightStickElement, rightStick.value[0], rightStick.value[1]);
  leftStickValue.textContent = `${formatAxis(moveX)} / ${formatAxis(moveY)}`;
  rightStickValue.textContent = `${formatAxis(rightStick.value[0])} / ${formatAxis(rightStick.value[1])}`;

  if (!newestInput && Math.hypot(moveX, moveY) > 0.12) {
    newestInput = 'Left stick';
  } else if (!newestInput && Math.hypot(rightStick.value[0], rightStick.value[1]) > 0.12) {
    newestInput = 'Right stick';
  }
  if (newestInput) {
    lastInput.textContent = newestInput;
  }

  const justPressed = (name: ButtonName) =>
    !!currentButtons.get(name) && !previousButtons.get(name);

  const input: GameInput = {
    aimX: rightStick.value[0],
    dashPressed: justPressed('B'),
    fireHeld: !!currentButtons.get('A') || !!currentButtons.get('R2'),
    moveX,
    moveY,
    pulsePressed: justPressed('Y'),
    resetPressed: justPressed('select'),
    shieldHeld: !!currentButtons.get('X') || !!currentButtons.get('L2'),
    startPressed: justPressed('start'),
  };

  const events = game.update(delta, input);
  applyRumble(events);
  game.render(context);

  const snapshot = game.getSnapshot();
  score.textContent = snapshot.score.toString().padStart(6, '0');
  wave.textContent = snapshot.wave.toString().padStart(2, '0');
  lives.textContent = Array.from({ length: 3 }, (_, index) =>
    index < snapshot.lives ? '●' : '○',
  ).join(' ');
  shieldValue.textContent = `${Math.round(snapshot.shield * 100)}%`;
  screenStatus.textContent =
    snapshot.mode === 'paused'
      ? 'Paused'
      : snapshot.mode === 'game-over'
        ? 'Signal lost'
        : connected
          ? 'Gamepad live'
          : 'Keyboard mode';

  connection.classList.toggle('is-connected', connected);
  connectionLabel.textContent = gamepad
    ? `${gamepad.id || 'Gamepad'} · #${gamepad.index}`
    : 'Waiting for a gamepad';

  for (const inputName of buttonNames) {
    previousButtons.set(inputName, !!currentButtons.get(inputName));
  }

  frameCount += 1;
  if (now - frameWindowStartedAt >= 1000) {
    pollRate.textContent = Math.round(
      (frameCount * 1000) / (now - frameWindowStartedAt),
    ).toString();
    frameCount = 0;
    frameWindowStartedAt = now;
  }

  requestAnimationFrame(update);
};

game.render(context);
requestAnimationFrame(update);
