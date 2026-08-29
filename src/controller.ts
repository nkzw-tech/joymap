import createBaseModule, { BaseModule } from './baseModule/base.ts';
import { buttonMap, mapValues, stickMap } from './common/utils.ts';
import { ButtonResult, ControllerOptions, InputResult, StickResult } from './types.ts';

type ControllerLifecycle = Pick<BaseModule['module'], 'destroy' | 'disconnect' | 'update'>;

export type Controller = Omit<BaseModule['module'], keyof ControllerLifecycle> & {
  getAllButtons: () => Partial<Record<string, ButtonResult>>;
  getAllSticks: () => Partial<Record<string, StickResult>>;
  getButton: (inputName: string) => ButtonResult;
  getButtons: (...inputNames: Array<string>) => Record<string, ButtonResult>;
  getStick: (inputName: string) => StickResult;
  getSticks: (...inputNames: Array<string>) => Record<string, StickResult>;
};

export type ControllerInternals = Controller & ControllerLifecycle;

export const isJustPressed = (input?: InputResult) => !!input?.pressed && input.justChanged;

export const isJustReleased = (input?: InputResult) =>
  !!input && !input.pressed && input.justChanged;

const createEmptyStick = (): StickResult => ({
  inverts: [false, false],
  justChanged: false,
  pressed: false,
  type: 'stick',
  value: [0, 0],
});

const createEmptyButton = (): ButtonResult => ({
  justChanged: false,
  pressed: false,
  type: 'button',
  value: 0,
});

export default function createController(params: ControllerOptions = {}): Controller {
  const { module: baseModule, state } = createBaseModule(params);

  const getButtonResult = (inputName: string) => {
    const button = state.buttons[inputName];
    return button
      ? buttonMap(
          state.pad,
          state.prevPad,
          button,
          state.buttonThreshold,
          state.clampThreshold,
          state.buttonPressStates[inputName],
        )
      : createEmptyButton();
  };

  const getStickResult = (inputName: string) => {
    const stick = state.sticks[inputName];
    if (!stick) {
      return createEmptyStick();
    }

    const { indexes, inverts } = stick;
    return stickMap(
      state.pad,
      state.prevPad,
      indexes,
      inverts,
      state.stickDeadzone,
      state.clampThreshold,
      state.stickPressStates[inputName],
      state.rescaleSticks,
    );
  };

  const controller: ControllerInternals = Object.assign(baseModule, {
    getAllButtons: (): Partial<Record<string, ButtonResult>> => {
      if (!controller.isConnected()) {
        return mapValues(() => createEmptyButton(), state.buttons);
      }

      return mapValues((_button, inputName) => getButtonResult(inputName), state.buttons);
    },

    getAllSticks: (): Partial<Record<string, StickResult>> => {
      if (!controller.isConnected()) {
        return mapValues(() => createEmptyStick(), state.sticks);
      }

      return mapValues((_stick, inputName) => getStickResult(inputName), state.sticks);
    },

    getButton: (inputName: string) => {
      if (!controller.isConnected()) {
        return createEmptyButton();
      }

      return getButtonResult(inputName);
    },

    getButtons: (...inputNames: Array<string>) => {
      if (!controller.isConnected()) {
        const result: Record<string, ButtonResult> = {};
        inputNames.forEach((inputName) => {
          result[inputName] = createEmptyButton();
        });

        return result;
      }

      const result: Record<string, ButtonResult> = {};
      inputNames.forEach((inputName) => {
        result[inputName] = getButtonResult(inputName);
      });

      return result;
    },

    getStick: (inputName: string) => {
      if (!controller.isConnected()) {
        return createEmptyStick();
      }

      return getStickResult(inputName);
    },

    getSticks: (...inputNames: Array<string>) => {
      if (!controller.isConnected()) {
        const result: Record<string, StickResult> = {};
        inputNames.forEach((inputName) => {
          result[inputName] = createEmptyStick();
        });

        return result;
      }

      const result: Record<string, StickResult> = {};
      inputNames.forEach((inputName) => {
        result[inputName] = getStickResult(inputName);
      });

      return result;
    },
  });

  return controller;
}
