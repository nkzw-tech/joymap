export type Button = ReadonlyArray<number>;

export type Stick = {
  indexes: ReadonlyArray<ReadonlyArray<number>>;
  inverts: ReadonlyArray<boolean>;
};

export interface ButtonResult {
  justChanged: boolean;
  pressed: boolean;
  type: 'button';
  value: number;
}

export interface StickResult {
  inverts: ReadonlyArray<boolean>;
  justChanged: boolean;
  pressed: boolean;
  type: 'stick';
  value: Array<number>;
}

export type InputResult = ButtonResult | StickResult;

export type RawGamepad = Gamepad;

export type CustomGamepad = {
  axes: ReadonlyArray<number>;
  buttons: Array<number>;
  pressedButtons: Array<boolean>;
  rawPad?: RawGamepad;
};

export type GamepadSnapshots = {
  current: CustomGamepad;
  previous: CustomGamepad;
};

export interface JoymapOptions {
  autoConnect?: boolean;
  onPoll?: () => void;
}

export interface ControllerOptions {
  buttonReleaseThreshold?: number;
  buttonThreshold?: number;
  clampThreshold?: boolean;
  gamepadIndex?: number;
  rescaleSticks?: boolean;
  stickDeadzone?: number;
  stickReleaseDeadzone?: number;
}

export type PressState = {
  current: boolean;
  previous: boolean;
  threshold: number;
};

export interface EffectObject {
  duration: number;
  strongMagnitude?: number;
  weakMagnitude?: number;
}

export type Effect = number | EffectObject;

// StrictEffect means all values are valid (duration > 0, magnitudes between 0 and 1)
export interface StrictEffect {
  duration: number;
  strongMagnitude: number;
  weakMagnitude: number;
}

export interface ListenOptions {
  allowOffset: boolean;
  callback: (indexes: Array<number> | Array<Array<number>>) => void;
  consecutive: boolean;
  currentValue: number;
  quantity: number;
  targetValue: number;
  type: 'buttons' | 'axes';
  useTimeStamp: boolean;
}
