import createController, { Controller, isJustPressed, isJustReleased } from './controller.ts';
import createJoymap, { Joymap } from './JoyMap.ts';
import {
  Button,
  ButtonResult,
  ControllerOptions,
  CustomGamepad,
  Effect,
  EffectObject,
  GamepadSnapshots,
  InputResult,
  JoymapOptions,
  RawGamepad,
  Stick,
  StickResult,
} from './types.ts';

export { createController, createJoymap, isJustPressed, isJustReleased };

export type {
  Button,
  ButtonResult,
  Controller,
  ControllerOptions,
  CustomGamepad,
  Effect,
  EffectObject,
  GamepadSnapshots,
  InputResult,
  Joymap,
  JoymapOptions,
  RawGamepad,
  Stick,
  StickResult,
};
