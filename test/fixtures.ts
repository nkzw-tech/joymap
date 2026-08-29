import { vi } from 'vite-plus/test';

type GamepadOptions = {
  axes?: ReadonlyArray<number>;
  buttons?: ReadonlyArray<GamepadButton>;
  connected?: boolean;
  id?: string;
  index?: number;
  mapping?: GamepadMappingType;
  timestamp?: number;
  vibrationActuator?: GamepadHapticActuator;
};

export function createButton(value = 0, pressed = value > 0, touched = pressed): GamepadButton {
  return { pressed, touched, value };
}

export function createButtons(values: ReadonlyArray<number>): ReadonlyArray<GamepadButton> {
  return values.map((value) => createButton(value));
}

export function createGamepad({
  axes = [0, 0, 0, 0],
  buttons = createButtons(Array.from({ length: 17 }, () => 0)),
  connected = true,
  id = 'test-gamepad',
  index = 0,
  mapping = 'standard',
  timestamp = 1,
  vibrationActuator,
}: GamepadOptions = {}): Gamepad {
  return {
    axes,
    buttons,
    connected,
    id,
    index,
    mapping,
    timestamp,
    vibrationActuator,
  } as Gamepad;
}

export function createHapticActuator() {
  return {
    playEffect: vi.fn(async () => 'complete' as GamepadHapticsResult),
    reset: vi.fn(async () => 'complete' as GamepadHapticsResult),
  } satisfies GamepadHapticActuator;
}

export function installNavigator(gamepads: ReadonlyArray<Gamepad | null>) {
  const getGamepads = vi.fn(() => gamepads);
  vi.stubGlobal('navigator', { getGamepads });
  return getGamepads;
}

export function installWindow() {
  const callbacks = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, EventListener>();
  let nextFrame = 1;

  const addEventListener = vi.fn((type: string, listener: EventListener) => {
    listeners.set(type, listener);
  });
  const cancelAnimationFrame = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  const removeEventListener = vi.fn((type: string) => {
    listeners.delete(type);
  });
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrame++;
    callbacks.set(id, callback);
    return id;
  });

  vi.stubGlobal('window', {
    addEventListener,
    cancelAnimationFrame,
    removeEventListener,
    requestAnimationFrame,
  });

  return {
    addEventListener,
    callbacks,
    cancelAnimationFrame,
    listeners,
    removeEventListener,
    requestAnimationFrame,
    runFrame(id: number) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.(0);
    },
  };
}
