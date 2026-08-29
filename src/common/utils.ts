import { ButtonResult, CustomGamepad, PressState, RawGamepad, StickResult } from '../types.ts';

// dev-helper type: expands object types one level deep
export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

// dev-helper type: expands object types recursively
export type ExpendRecursively<T> = T extends object
  ? T extends infer O
    ? { [K in keyof O]: ExpendRecursively<O[K]> }
    : never
  : T;

export function isConsecutive(target: Array<number>) {
  const { length } = target;

  if (length <= 1) {
    return true;
  }

  let i = 0;
  while (i < length - 1) {
    if (target[i] + 1 !== target[i + 1]) {
      return false;
    }
    i += 1;
  }

  return true;
}

export function findIndexes(
  iterator: (value: number, index: number) => boolean,
  target: ReadonlyArray<number>,
) {
  const { length } = target;
  const result = [];
  let i = 0;

  while (i < length) {
    if (iterator(target[i], i)) {
      result.push(i);
    }
    i += 1;
  }

  return result;
}

export function getRawGamepads(): Array<RawGamepad> {
  const result: Array<RawGamepad> = [];
  if (typeof navigator !== 'undefined' && navigator.getGamepads) {
    const gamepads = navigator.getGamepads();
    for (let index = 0; index < gamepads.length; index++) {
      const gamepad = gamepads[index];
      if (gamepadIsValid(gamepad)) {
        result.push(gamepad);
      }
    }
  }
  return result;
}

export function gamepadIsValid(rawGamepad: RawGamepad | null): rawGamepad is RawGamepad {
  return !!rawGamepad?.connected;
}

export function nameIsValid(name: string) {
  return /^[\da-z]+$/i.test(name);
}

export function isButtonSignificant(value = 0, threshold: number) {
  return Math.abs(value) > threshold;
}

export function isMappedButtonPressed(
  pad: CustomGamepad,
  indexes: ReadonlyArray<number>,
  threshold: number,
) {
  for (const index of indexes) {
    if (pad.pressedButtons[index] || isButtonSignificant(pad.buttons[index], threshold)) {
      return true;
    }
  }
  return false;
}

export function isStickSignificant(stickValue: ReadonlyArray<number>, threshold: number) {
  let squaredMagnitude = 0;
  for (let index = 0; index < stickValue.length; index++) {
    squaredMagnitude += stickValue[index] ** 2;
  }
  return threshold * threshold < squaredMagnitude;
}

export function buttonMap(
  pad: CustomGamepad,
  prevPad: CustomGamepad,
  indexes: ReadonlyArray<number>,
  threshold: number,
  clampThreshold: boolean,
  pressState?: PressState,
): ButtonResult {
  const { length } = indexes;

  let prevPressed = pressState?.previous ?? false;
  let value = 0;
  let pressed = pressState?.current ?? false;

  let i = 0;
  while (i < length) {
    if (!pressState && !prevPressed) {
      const prevValue = prevPad.buttons[indexes[i]] || 0;
      prevPressed =
        !!prevPad.pressedButtons[indexes[i]] || isButtonSignificant(prevValue, threshold);
    }

    const currValue = pad.buttons[indexes[i]] || 0;
    value = Math.max(value, currValue);
    if (!pressState && !pressed) {
      pressed = !!pad.pressedButtons[indexes[i]] || isButtonSignificant(currValue, threshold);
    }

    i += 1;
  }

  return {
    justChanged: pressed !== prevPressed,
    pressed,
    type: 'button',
    value: !clampThreshold || pressed ? value : 0,
  };
}

function rescaleStickInPlace(value: Array<number>, deadzone: number) {
  let squaredMagnitude = 0;
  for (let index = 0; index < value.length; index++) {
    squaredMagnitude += value[index] ** 2;
  }

  const magnitude = Math.sqrt(squaredMagnitude);
  if (magnitude === 0 || deadzone >= 1) {
    for (let index = 0; index < value.length; index++) {
      value[index] = 0;
    }
    return value;
  }

  const scaledMagnitude = Math.min(1, Math.max(0, (magnitude - deadzone) / (1 - deadzone)));
  const scale = scaledMagnitude / magnitude;
  for (let index = 0; index < value.length; index++) {
    value[index] *= scale;
  }
  return value;
}

export function rescaleStick(value: ReadonlyArray<number>, deadzone: number) {
  return rescaleStickInPlace(Array.from(value), deadzone);
}

function indexMapIsSignificant(
  indexes: ReadonlyArray<number>,
  axes: ReadonlyArray<number>,
  squaredThreshold: number,
) {
  let squaredMagnitude = 0;
  for (let index = 0; index < indexes.length; index++) {
    const value = axes[indexes[index]];
    squaredMagnitude += value * value;
  }
  return squaredThreshold < squaredMagnitude;
}

export function mappedStickIsSignificant(
  indexMaps: ReadonlyArray<ReadonlyArray<number>>,
  axes: ReadonlyArray<number>,
  threshold: number,
) {
  const axisCount = indexMaps[0].length;
  const squaredThreshold = threshold * threshold;

  if (axisCount === 2) {
    let firstAxis = 0;
    let secondAxis = 0;
    let stickCount = 0;
    for (let stickIndex = 0; stickIndex < indexMaps.length; stickIndex++) {
      const indexes = indexMaps[stickIndex];
      if (indexMapIsSignificant(indexes, axes, squaredThreshold)) {
        firstAxis += axes[indexes[0]];
        secondAxis += axes[indexes[1]];
        stickCount += 1;
      }
    }
    if (stickCount === 0) {
      return false;
    }
    firstAxis /= stickCount;
    secondAxis /= stickCount;
    return squaredThreshold < firstAxis * firstAxis + secondAxis * secondAxis;
  }

  let stickCount = 0;
  for (let stickIndex = 0; stickIndex < indexMaps.length; stickIndex++) {
    if (indexMapIsSignificant(indexMaps[stickIndex], axes, squaredThreshold)) {
      stickCount += 1;
    }
  }
  if (stickCount === 0) {
    return false;
  }

  let squaredMagnitude = 0;
  for (let axisIndex = 0; axisIndex < axisCount; axisIndex++) {
    let sum = 0;
    for (let stickIndex = 0; stickIndex < indexMaps.length; stickIndex++) {
      const indexes = indexMaps[stickIndex];
      if (indexMapIsSignificant(indexes, axes, squaredThreshold)) {
        sum += axes[indexes[axisIndex]];
      }
    }
    const average = sum / stickCount;
    squaredMagnitude += average * average;
  }
  return squaredThreshold < squaredMagnitude;
}

export function roundSticks(
  indexMaps: ReadonlyArray<ReadonlyArray<number>>,
  axes: ReadonlyArray<number>,
  threshold: number,
  output: Array<number> = new Array<number>(indexMaps[0].length),
) {
  const axisCount = indexMaps[0].length;
  const squaredThreshold = threshold * threshold;
  output.length = axisCount;
  for (let axisIndex = 0; axisIndex < axisCount; axisIndex++) {
    output[axisIndex] = 0;
  }

  let stickCount = 0;
  for (let stickIndex = 0; stickIndex < indexMaps.length; stickIndex++) {
    const indexes = indexMaps[stickIndex];
    if (indexMapIsSignificant(indexes, axes, squaredThreshold)) {
      for (let axisIndex = 0; axisIndex < axisCount; axisIndex++) {
        output[axisIndex] += axes[indexes[axisIndex]];
      }
      stickCount += 1;
    }
  }

  if (stickCount > 0) {
    for (let axisIndex = 0; axisIndex < axisCount; axisIndex++) {
      output[axisIndex] /= stickCount;
    }
  }
  return output;
}

export function stickMap(
  pad: CustomGamepad,
  prevPad: CustomGamepad,
  indexMaps: ReadonlyArray<ReadonlyArray<number>>,
  inverts: ReadonlyArray<boolean>,
  threshold: number,
  clampThreshold: boolean,
  pressState?: PressState,
  rescale = false,
): StickResult {
  const prevPressed =
    pressState?.previous ?? mappedStickIsSignificant(indexMaps, prevPad.axes, threshold);
  const value = roundSticks(indexMaps, pad.axes, pressState?.threshold ?? threshold);
  const pressed = pressState?.current ?? isStickSignificant(value, threshold);

  for (let index = 0; index < value.length; index++) {
    if (inverts[index]) {
      value[index] *= -1;
    }
  }

  if (clampThreshold && !pressed) {
    for (let index = 0; index < value.length; index++) {
      value[index] = 0;
    }
  } else if (rescale) {
    rescaleStickInPlace(value, threshold);
  }

  return {
    inverts,
    justChanged: pressed !== prevPressed,
    pressed,
    type: 'stick',
    value,
  };
}

export function mapValues<T, S>(fn: (value: T, key: string) => S, object: Record<string, T>) {
  const result: Record<string, S> = {};
  for (const key of Object.keys(object)) {
    result[key] = fn(object[key], key);
  }
  return result;
}
