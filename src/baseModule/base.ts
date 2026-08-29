import {
  findIndexes,
  isButtonSignificant,
  isConsecutive,
  isMappedButtonPressed,
  mappedStickIsSignificant,
  nameIsValid,
} from '../common/utils.ts';
import {
  Button,
  ControllerOptions,
  CustomGamepad,
  Effect,
  GamepadSnapshots,
  ListenOptions,
  PressState,
  RawGamepad,
  Stick,
} from '../types.ts';
import {
  addRumble,
  releaseRumbleOwner,
  requestRumbleRefresh,
  resetRumble,
  stopRumble,
  updateRumble,
} from './rumble.ts';

export type BaseModule = ReturnType<typeof createModule>;

interface BaseState {
  buttonPressStates: Record<string, PressState>;
  buttonReleaseThreshold: number;
  buttons: Record<string, Button>;
  buttonThreshold: number;
  clampThreshold: boolean;
  pad: CustomGamepad;
  prevPad: CustomGamepad;
  rescaleSticks: boolean;
  stickDeadzone: number;
  stickPressStates: Record<string, PressState>;
  stickReleaseDeadzone: number;
  sticks: Record<string, Stick>;
}

const mockGamepad: CustomGamepad = {
  axes: [],
  buttons: [],
  pressedButtons: [],
  rawPad: undefined,
};

const DEFAULT_HYSTERESIS = 0.05;
const DEFAULT_THRESHOLD = 0.2;

function validateThreshold(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be a finite number between 0 and 1`);
  }
}

function validateIndexes(inputName: string, indexes: ReadonlyArray<number>) {
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(`'${inputName}' indexes must be non-negative integers`);
    }
  }
}

function updateListenOptions(
  listenOptions: ListenOptions,
  pad: CustomGamepad,
  buttonThreshold: number,
  stickDeadzone: number,
) {
  const {
    allowOffset,
    callback,
    consecutive,
    currentValue,
    quantity,
    targetValue,
    type,
    useTimeStamp,
  } = listenOptions;

  const indexes =
    type === 'axes'
      ? findIndexes((value) => Math.abs(value) > stickDeadzone, pad.axes)
      : findIndexes(
          (value, index) =>
            pad.pressedButtons[index] || isButtonSignificant(value, buttonThreshold),
          pad.buttons,
        );

  if (
    indexes.length === quantity &&
    (!consecutive || isConsecutive(indexes)) &&
    (allowOffset || indexes[0] % quantity === 0)
  ) {
    if (useTimeStamp && currentValue < 0) {
      listenOptions.currentValue = performance.now();
      return listenOptions;
    }

    const comparison = useTimeStamp ? performance.now() - currentValue : currentValue + 1;

    if (targetValue <= comparison) {
      if (type === 'axes') {
        callback([indexes]);
      } else {
        callback(indexes);
      }
      return null;
    }

    if (!useTimeStamp) {
      listenOptions.currentValue = comparison;
    }

    return listenOptions;
  }

  listenOptions.currentValue = useTimeStamp ? -1 : 0;
  return listenOptions;
}

function getDefaultButtons(): Record<string, Button> {
  const buttons: Record<string, Button> = {
    A: [0],
    B: [1],
    dpadDown: [13],
    dpadLeft: [14],
    dpadRight: [15],
    dpadUp: [12],
    home: [16],
    L1: [4],
    L2: [6],
    L3: [10],
    R1: [5],
    R2: [7],
    R3: [11],
    select: [8],
    start: [9],
    X: [2],
    Y: [3],
  };
  for (const inputName of Object.keys(buttons)) {
    buttons[inputName] = Object.freeze(Array.from(buttons[inputName]));
  }
  return buttons;
}

const freezeIndexes = (indexes: ReadonlyArray<number>) => Object.freeze(Array.from(indexes));

const createStick = (
  indexes: ReadonlyArray<ReadonlyArray<number>>,
  inverts: ReadonlyArray<boolean> = indexes[0].map(() => false),
): Stick => ({
  indexes: Object.freeze(indexes.map(freezeIndexes)),
  inverts: Object.freeze(Array.from(inverts)),
});

function getDefaultSticks(): Record<string, Stick> {
  return {
    L: createStick([[0, 1]]),
    R: createStick([[2, 3]]),
  };
}

const findKey = <T>(fn: (item: T) => boolean, object: Record<string, T>): string | null => {
  for (const key of Object.keys(object)) {
    if (fn(object[key])) {
      return key;
    }
  }
  return null;
};

export default function createModule(params: ControllerOptions = {}) {
  for (const [name, value] of Object.entries({
    buttonReleaseThreshold: params.buttonReleaseThreshold,
    buttonThreshold: params.buttonThreshold,
    stickDeadzone: params.stickDeadzone,
    stickReleaseDeadzone: params.stickReleaseDeadzone,
  })) {
    if (value !== undefined) {
      validateThreshold(name, value);
    }
  }

  if (
    params.gamepadIndex !== undefined &&
    (!Number.isInteger(params.gamepadIndex) || params.gamepadIndex < 0)
  ) {
    throw new RangeError('gamepadIndex must be a non-negative integer');
  }

  const buttonThreshold = params.buttonThreshold ?? DEFAULT_THRESHOLD;
  const buttonReleaseThreshold =
    params.buttonReleaseThreshold ?? Math.max(0, buttonThreshold - DEFAULT_HYSTERESIS);
  const stickDeadzone = params.stickDeadzone ?? DEFAULT_THRESHOLD;
  const stickReleaseDeadzone =
    params.stickReleaseDeadzone ?? Math.max(0, stickDeadzone - DEFAULT_HYSTERESIS);

  if (buttonReleaseThreshold > buttonThreshold) {
    throw new RangeError('buttonReleaseThreshold must not exceed buttonThreshold');
  }
  if (stickReleaseDeadzone > stickDeadzone) {
    throw new RangeError('stickReleaseDeadzone must not exceed stickDeadzone');
  }

  let listenOptions: ListenOptions | null = null;
  let standardLayoutActive = false;
  let gamepadIndex = params.gamepadIndex ?? null;
  let connected = false;
  const customButtonNames = new Set<string>();
  const customStickNames = new Set<string>();
  const rumbleOwner = {};

  const state: BaseState = {
    buttonPressStates: {},
    buttonReleaseThreshold,
    buttons: {},
    buttonThreshold,
    clampThreshold: params.clampThreshold !== false,
    pad: mockGamepad,
    prevPad: mockGamepad,
    rescaleSticks: !!params.rescaleSticks,
    stickDeadzone,
    stickPressStates: {},
    stickReleaseDeadzone,
    sticks: {},
  };

  const applyDefaultLayout = (gamepad: RawGamepad) => {
    if (!standardLayoutActive && gamepad.mapping === 'standard') {
      for (const [inputName, indexes] of Object.entries(getDefaultButtons())) {
        if (!customButtonNames.has(inputName)) {
          state.buttons[inputName] = indexes;
        }
      }
      for (const [inputName, stick] of Object.entries(getDefaultSticks())) {
        if (!customStickNames.has(inputName)) {
          state.sticks[inputName] = stick;
        }
      }
      standardLayoutActive = true;
    } else if (standardLayoutActive && gamepad.mapping !== 'standard') {
      for (const inputName of Object.keys(getDefaultButtons())) {
        if (!customButtonNames.has(inputName)) {
          delete state.buttonPressStates[inputName];
          delete state.buttons[inputName];
        }
      }
      for (const inputName of Object.keys(getDefaultSticks())) {
        if (!customStickNames.has(inputName)) {
          delete state.stickPressStates[inputName];
          delete state.sticks[inputName];
        }
      }
      standardLayoutActive = false;
    }
  };

  const updatePressStates = () => {
    for (const inputName in state.buttons) {
      const indexes = state.buttons[inputName];
      const pressState = state.buttonPressStates[inputName];
      const previous = pressState?.current ?? false;
      const inputThreshold = previous ? state.buttonReleaseThreshold : state.buttonThreshold;
      const current = isMappedButtonPressed(state.pad, indexes, inputThreshold);
      if (pressState) {
        pressState.current = current;
        pressState.previous = previous;
        pressState.threshold = inputThreshold;
      } else {
        state.buttonPressStates[inputName] = { current, previous, threshold: inputThreshold };
      }
    }

    for (const inputName in state.sticks) {
      const { indexes } = state.sticks[inputName];
      const pressState = state.stickPressStates[inputName];
      const previous = pressState?.current ?? false;
      const inputThreshold = previous ? state.stickReleaseDeadzone : state.stickDeadzone;
      const current = mappedStickIsSignificant(indexes, state.pad.axes, inputThreshold);
      if (pressState) {
        pressState.current = current;
        pressState.previous = previous;
        pressState.threshold = inputThreshold;
      } else {
        state.stickPressStates[inputName] = { current, previous, threshold: inputThreshold };
      }
    }
  };

  const module = {
    addRumble: (effect: Effect | Array<Effect>, channelName?: string) => {
      if (state.pad.rawPad) {
        addRumble(state.pad.rawPad.index, effect, channelName, rumbleOwner);
      }
    },

    assign: (index: number) => {
      if (!Number.isInteger(index) || index < 0) {
        throw new RangeError('gamepadIndex must be a non-negative integer');
      }
      if (gamepadIndex !== index) {
        module.disconnect();
        gamepadIndex = index;
      }
    },

    buttonBindOnPress: (
      inputName: string,
      callback: (buttonName?: string) => void,
      allowDuplication = false,
    ) => {
      if (!nameIsValid(inputName)) {
        throw new Error(
          `On buttonBindOnPress('${inputName}'): inputName contains invalid characters`,
        );
      }

      module.listenButton((indexes: Array<number>) => {
        const resultName = findKey((value) => value[0] === indexes[0], state.buttons);

        if (!allowDuplication && resultName && state.buttons[inputName]) {
          module.swapButtons(inputName, resultName);
        } else {
          module.setButton(inputName, indexes);
        }

        if (resultName) {
          callback(resultName);
        }
      });
    },

    cancelListen: () => {
      listenOptions = null;
    },

    destroy: () => {
      module.unassign();
    },
    disconnect: () => {
      if (state.pad.rawPad) {
        releaseRumbleOwner(state.pad.rawPad, rumbleOwner);
      }
      connected = false;
      state.buttonPressStates = {};
      state.pad = mockGamepad;
      state.prevPad = mockGamepad;
      state.stickPressStates = {};
    },

    getButtonIndexes: (...inputNames: Array<string>) => {
      const result = new Set<number>();
      for (const inputName of inputNames) {
        for (const index of state.buttons[inputName] ?? []) {
          result.add(index);
        }
      }
      return [...result];
    },

    getGamepad: (): RawGamepad | null => (connected ? state.pad.rawPad! : null),

    getGamepadIndex: () => gamepadIndex,

    getStickIndexes: (...inputNames: Array<string>) => {
      const keys = new Set<string>();
      const result: Array<ReadonlyArray<number>> = [];
      for (const inputName of inputNames) {
        for (const indexes of state.sticks[inputName]?.indexes ?? []) {
          const key = JSON.stringify(indexes);
          if (!keys.has(key)) {
            keys.add(key);
            result.push(indexes);
          }
        }
      }
      return result;
    },

    invertSticks: (inverts: ReadonlyArray<boolean>, ...inputNames: Array<string>) => {
      inputNames.forEach((inputName) => {
        customStickNames.add(inputName);
        const stick = state.sticks[inputName];
        if (!stick) {
          throw new Error(`On invertSticks: unknown stick '${inputName}'`);
        }
        if (stick.inverts.length === inverts.length) {
          stick.inverts = Object.freeze(Array.from(inverts));
        } else {
          throw new Error(
            `On invertSticks(inverts, [..., ${inputName}, ...]): given argument inverts' length does not match '${inputName}' axis' length`,
          );
        }
      });
    },

    isConnected: () => connected,

    isRumbleSupported: (rawPad?: RawGamepad): boolean | null => {
      const padToTest = rawPad ?? module.getGamepad();
      return padToTest
        ? !!padToTest.vibrationActuator && !!padToTest.vibrationActuator.playEffect
        : null;
    },

    listenAxis: (
      callback: (indexes: Array<Array<number>>) => void,
      quantity = 2,
      {
        allowOffset = true,
        consecutive = true,
        waitFor = [100, 'ms'],
      }: {
        allowOffset?: boolean;
        consecutive?: boolean;
        waitFor?: [number, 'polls' | 'ms'];
      } = {},
    ) => {
      listenOptions = {
        allowOffset,
        callback: callback as (indexes: Array<number> | Array<Array<number>>) => void,
        consecutive,
        currentValue: waitFor[1] === 'ms' ? -1 : 0,
        quantity,
        targetValue: waitFor[0],
        type: 'axes',
        useTimeStamp: waitFor[1] === 'ms',
      };
    },

    listenButton: (
      callback: (indexes: Array<number>) => void,
      quantity = 1,
      {
        allowOffset = true,
        consecutive = false,
        waitFor = [1, 'polls'],
      }: {
        allowOffset?: boolean;
        consecutive?: boolean;
        waitFor?: [number, 'polls' | 'ms'];
      } = {},
    ) => {
      listenOptions = {
        allowOffset,
        callback: callback as (indexes: Array<number> | Array<Array<number>>) => void,
        consecutive,
        currentValue: waitFor[1] === 'ms' ? -1 : 0,
        quantity,
        targetValue: waitFor[0],
        type: 'buttons',
        useTimeStamp: waitFor[1] === 'ms',
      };
    },

    setButton: (inputName: string, indexes: ReadonlyArray<number>) => {
      if (!nameIsValid(inputName)) {
        throw new Error(`On setButton('${inputName}'): argument contains invalid characters`);
      }
      validateIndexes(inputName, indexes);
      state.buttons[inputName] = freezeIndexes(indexes);
      customButtonNames.add(inputName);
      delete state.buttonPressStates[inputName];
    },

    setStick: (
      inputName: string,
      indexes: ReadonlyArray<ReadonlyArray<number>>,
      inverts?: ReadonlyArray<boolean>,
    ) => {
      if (!nameIsValid(inputName)) {
        throw new Error(`On setStick('${inputName}'): inputName contains invalid characters`);
      }

      if (indexes.length === 0) {
        throw new Error(`On setStick('${inputName}', indexes): argument indexes is an empty array`);
      }

      const axisCount = indexes[0].length;
      if (axisCount === 0 || indexes.some((indexMap) => indexMap.length !== axisCount)) {
        throw new Error(
          `On setStick('${inputName}', indexes): all index groups must have the same non-zero length`,
        );
      }
      for (const indexMap of indexes) {
        validateIndexes(inputName, indexMap);
      }
      if (inverts && inverts.length !== axisCount) {
        throw new Error(
          `On setStick('${inputName}', indexes, inverts): inverts must match the axis count`,
        );
      }

      state.sticks[inputName] = createStick(indexes, inverts);
      customStickNames.add(inputName);
      delete state.stickPressStates[inputName];
    },

    stickBindOnPress: (
      inputName: string,
      callback: (stickName?: string) => void,
      allowDuplication = false,
    ) => {
      if (!nameIsValid(inputName)) {
        throw new Error(
          `On stickBindOnPress('${inputName}'): inputName contains invalid characters`,
        );
      }

      module.listenAxis((indexesResult: Array<Array<number>>) => {
        const resultName = findKey(({ indexes }) => {
          if (indexes.length !== indexesResult.length) {
            return false;
          }

          for (let i = 0; i < indexes.length; i++) {
            if (indexes[i].length !== indexesResult[i].length) {
              return false;
            }

            for (let axis = 0; axis < indexes[i].length; axis++) {
              if (indexes[i][axis] !== indexesResult[i][axis]) {
                return false;
              }
            }
          }
          return true;
        }, state.sticks);

        if (!allowDuplication && resultName && state.sticks[inputName]) {
          module.swapSticks(inputName, resultName);
        } else {
          module.setStick(inputName, indexesResult);
        }

        if (resultName) {
          callback(resultName);
        }
      });
    },

    stopRumble: (channelName?: string) => {
      const gamepad = state.pad.rawPad;
      if (gamepad && stopRumble(gamepad.index, channelName, rumbleOwner)) {
        const reset = resetRumble(gamepad);
        if (reset) {
          void reset.catch(() => undefined);
        }
        requestRumbleRefresh(gamepad.index);
      }
    },

    swapButtons: (btn1: string, btn2: string) => {
      const { buttons } = state;
      if (!buttons[btn1] || !buttons[btn2]) {
        throw new Error(`On swapButtons: unknown button '${!buttons[btn1] ? btn1 : btn2}'`);
      }
      [buttons[btn1], buttons[btn2]] = [buttons[btn2], buttons[btn1]];
      customButtonNames.add(btn1);
      customButtonNames.add(btn2);
      delete state.buttonPressStates[btn1];
      delete state.buttonPressStates[btn2];
    },

    swapSticks: (stick1: string, stick2: string, includeInverts = false) => {
      const { sticks } = state;
      if (!sticks[stick1] || !sticks[stick2]) {
        throw new Error(`On swapSticks: unknown stick '${!sticks[stick1] ? stick1 : stick2}'`);
      }
      if (includeInverts) {
        [sticks[stick1], sticks[stick2]] = [sticks[stick2], sticks[stick1]];
      } else {
        [sticks[stick1].indexes, sticks[stick2].indexes] = [
          sticks[stick2].indexes,
          sticks[stick1].indexes,
        ];
      }
      customStickNames.add(stick1);
      customStickNames.add(stick2);
      delete state.stickPressStates[stick1];
      delete state.stickPressStates[stick2];
    },

    unassign: () => {
      module.disconnect();
      gamepadIndex = null;
    },

    update: (gamepad: RawGamepad, snapshots?: GamepadSnapshots) => {
      const previousGamepad = state.pad.rawPad;
      if (previousGamepad && previousGamepad.index !== gamepad.index) {
        releaseRumbleOwner(previousGamepad, rumbleOwner);
      }
      gamepadIndex = gamepad.index;
      connected = true;
      if (snapshots) {
        state.prevPad = snapshots.previous;
        state.pad = snapshots.current;
      } else {
        state.prevPad = state.pad;
        state.pad = {
          axes: gamepad.axes,
          buttons: gamepad.buttons.map((a) => a.value),
          pressedButtons: gamepad.buttons.map((button) => button.pressed),
          rawPad: gamepad,
        };
      }

      applyDefaultLayout(gamepad);

      if (listenOptions) {
        listenOptions = updateListenOptions(
          listenOptions,
          state.pad,
          state.buttonThreshold,
          state.stickDeadzone,
        );
      }

      updatePressStates();

      updateRumble(gamepad, rumbleOwner);
    },
  };

  return { module, state };
}
