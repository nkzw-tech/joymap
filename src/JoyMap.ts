import { clearRumble, resetRumble } from './baseModule/rumble.ts';
import { getRawGamepads } from './common/utils.ts';
import { Controller, ControllerInternals } from './controller.ts';
import { CustomGamepad, GamepadSnapshots, JoymapOptions, RawGamepad } from './types.ts';

type MutableGamepadSnapshot = Omit<CustomGamepad, 'axes'> & { axes: Array<number> };

type SnapshotRecord = GamepadSnapshots & {
  buffers: [MutableGamepadSnapshot, MutableGamepadSnapshot];
  currentBuffer: 0 | 1;
  timestamp: number;
};

type JoymapState = {
  readonly autoConnect: boolean;
  controllers: Array<Controller>;
  gamepads: ReadonlyArray<RawGamepad>;
  gamepadsByIndex: Map<number, RawGamepad>;
  readonly onPoll: () => void;
  snapshotsByIndex: Map<number, SnapshotRecord>;
  usedGamepadIndexes: Set<number>;
};

export type Joymap = ReturnType<typeof createJoymap>;

const noop = () => {};

const createSnapshot = (gamepad: RawGamepad): MutableGamepadSnapshot => ({
  axes: new Array<number>(gamepad.axes.length).fill(0),
  buttons: new Array<number>(gamepad.buttons.length).fill(0),
  pressedButtons: new Array<boolean>(gamepad.buttons.length).fill(false),
});

const writeSnapshot = (snapshot: MutableGamepadSnapshot, gamepad: RawGamepad) => {
  snapshot.axes.length = gamepad.axes.length;
  for (let index = 0; index < gamepad.axes.length; index++) {
    snapshot.axes[index] = gamepad.axes[index];
  }

  snapshot.buttons.length = gamepad.buttons.length;
  snapshot.pressedButtons.length = gamepad.buttons.length;
  for (let index = 0; index < gamepad.buttons.length; index++) {
    snapshot.buttons[index] = gamepad.buttons[index].value;
    snapshot.pressedButtons[index] = gamepad.buttons[index].pressed;
  }
  snapshot.rawPad = gamepad;
};

const createSnapshotRecord = (gamepad: RawGamepad): SnapshotRecord => {
  const previous = createSnapshot(gamepad);
  const current = createSnapshot(gamepad);
  writeSnapshot(current, gamepad);
  return {
    buffers: [previous, current],
    current,
    currentBuffer: 1,
    previous,
    timestamp: gamepad.timestamp,
  };
};

const updateSnapshotRecord = (record: SnapshotRecord, gamepad: RawGamepad) => {
  if (gamepad.timestamp !== 0 && record.timestamp === gamepad.timestamp) {
    record.current.rawPad = gamepad;
    record.previous = record.current;
    return;
  }

  const currentBuffer = record.currentBuffer === 0 ? 1 : 0;
  const current = record.buffers[currentBuffer];
  writeSnapshot(current, gamepad);
  record.previous = record.current;
  record.current = current;
  record.currentBuffer = currentBuffer;
  record.timestamp = gamepad.timestamp;
};

export default function createJoymap({ autoConnect, onPoll = noop }: JoymapOptions = {}) {
  const state: JoymapState = {
    autoConnect: !!autoConnect,
    controllers: [],
    gamepads: [],
    gamepadsByIndex: new Map(),
    onPoll,
    snapshotsByIndex: new Map(),
    usedGamepadIndexes: new Set(),
  };

  const onGamepadChange = () => joymap.start();
  let animationFrameRequestId: number | null = null;
  let loopRevision = 0;
  let running = false;
  const rebuildUsedGamepadIndexes = () => {
    state.usedGamepadIndexes.clear();
    for (const controller of state.controllers) {
      const gamepadIndex = controller.getGamepadIndex();
      if (gamepadIndex !== null) {
        state.usedGamepadIndexes.add(gamepadIndex);
      }
    }
  };
  const getUnusedGamepad = () => {
    for (const gamepad of state.gamepads) {
      if (!state.usedGamepadIndexes.has(gamepad.index)) {
        return gamepad;
      }
    }
    return undefined;
  };
  const getUnusedGamepads = () => {
    const result: Array<RawGamepad> = [];
    for (const gamepad of state.gamepads) {
      if (!state.usedGamepadIndexes.has(gamepad.index)) {
        result.push(gamepad);
      }
    }
    return result;
  };
  const joymap = {
    addController: (controller: Controller) => {
      if (state.controllers.includes(controller)) {
        return controller;
      }
      state.controllers.push(controller);
      const assignedGamepadIndex = controller.getGamepadIndex();
      if (assignedGamepadIndex !== null) {
        state.usedGamepadIndexes.add(assignedGamepadIndex);
      }

      if (state.autoConnect && controller.getGamepadIndex() === null) {
        const gamepad = getUnusedGamepad();
        if (gamepad) {
          controller.assign(gamepad.index);
          state.usedGamepadIndexes.add(gamepad.index);
        }
      }
      return controller;
    },

    clearControllers: () => {
      while (state.controllers.length > 0) {
        joymap.removeController(state.controllers.at(-1)!);
      }
    },

    getControllers: (): ReadonlyArray<Controller> => [...state.controllers],

    getGamepads: (): ReadonlyArray<RawGamepad> => state.gamepads,

    getUnusedGamepadIndex: (): number | undefined => getUnusedGamepad()?.index,

    getUnusedGamepadIndexes: () => getUnusedGamepads().map(({ index }) => index),

    poll: () => {
      state.gamepads = Object.freeze(getRawGamepads());
      state.gamepadsByIndex.clear();
      for (const gamepad of state.gamepads) {
        state.gamepadsByIndex.set(gamepad.index, gamepad);
        const snapshots = state.snapshotsByIndex.get(gamepad.index);
        if (snapshots) {
          updateSnapshotRecord(snapshots, gamepad);
        } else {
          state.snapshotsByIndex.set(gamepad.index, createSnapshotRecord(gamepad));
        }
      }
      for (const padIndex of state.snapshotsByIndex.keys()) {
        if (!state.gamepadsByIndex.has(padIndex)) {
          const gamepad = state.snapshotsByIndex.get(padIndex)!.current.rawPad!;
          clearRumble(padIndex);
          const reset = resetRumble(gamepad);
          if (reset) {
            void reset.catch(() => undefined);
          }
          state.snapshotsByIndex.delete(padIndex);
        }
      }
      rebuildUsedGamepadIndexes();

      for (const controller of state.controllers) {
        const controllerInternals = controller as ControllerInternals;
        const gamepadIndex = controller.getGamepadIndex();
        let gamepad = gamepadIndex === null ? undefined : state.gamepadsByIndex.get(gamepadIndex);

        if (!gamepad && state.autoConnect && gamepadIndex === null) {
          gamepad = getUnusedGamepad();
        }

        if (gamepad) {
          if (controller.getGamepadIndex() !== gamepad.index) {
            controller.assign(gamepad.index);
          }
          state.usedGamepadIndexes.add(gamepad.index);
          controllerInternals.update(gamepad, state.snapshotsByIndex.get(gamepad.index));
        } else if (controller.isConnected()) {
          controllerInternals.disconnect();
        }
      }

      state.onPoll();
    },

    removeController: (controller: Controller) => {
      if (!state.controllers.includes(controller)) {
        return false;
      }
      state.controllers = state.controllers.filter((item) => item !== controller);
      rebuildUsedGamepadIndexes();
      (controller as ControllerInternals).destroy();
      return true;
    },

    start: () => {
      if (running) {
        return;
      }

      running = true;
      const currentLoopRevision = ++loopRevision;

      window.addEventListener('gamepadconnected', onGamepadChange);
      window.addEventListener('gamepaddisconnected', onGamepadChange);

      const step = () => {
        animationFrameRequestId = null;
        if (!running || currentLoopRevision !== loopRevision) {
          return;
        }

        try {
          joymap.poll();
        } catch (error) {
          joymap.stop();
          throw error;
        }

        if (!running || currentLoopRevision !== loopRevision) {
          return;
        }

        if (state.gamepads.length > 0) {
          animationFrameRequestId = window.requestAnimationFrame(step);
        } else {
          running = false;
        }
      };

      try {
        joymap.poll();
      } catch (error) {
        joymap.stop();
        throw error;
      }
      if (!running || currentLoopRevision !== loopRevision) {
        return;
      }
      animationFrameRequestId = window.requestAnimationFrame(step);
    },

    stop: () => {
      running = false;
      loopRevision += 1;
      if (animationFrameRequestId !== null) {
        window.cancelAnimationFrame(animationFrameRequestId);
        animationFrameRequestId = null;
      }

      window.removeEventListener('gamepadconnected', onGamepadChange);
      window.removeEventListener('gamepaddisconnected', onGamepadChange);
    },
  };

  return joymap;
}
