import { Effect, RawGamepad, StrictEffect } from '../types.ts';

type GamepadIndex = number;
type ChannelName = string;
export type RumbleOwner = object;

type RumbleChannel = {
  cursor: number;
  effects: Array<StrictEffect>;
  elapsed: number;
  updatedAt: number;
};

type RumbleController = {
  channelsByOwner: Map<RumbleOwner, Map<ChannelName, RumbleChannel>>;
  lastAppliedAt: number;
  lastStrongMagnitude: number;
  lastWeakMagnitude: number;
  needsRefresh: boolean;
  owners: Set<RumbleOwner>;
};

export const MAX_DURATION = 5000;
const defaultChannel = 'default';
const defaultOwner: RumbleOwner = {};
const allControllers = new Map<GamepadIndex, RumbleController>();

const createController = (): RumbleController => ({
  channelsByOwner: new Map(),
  lastAppliedAt: performance.now(),
  lastStrongMagnitude: 0,
  lastWeakMagnitude: 0,
  needsRefresh: false,
  owners: new Set(),
});

const getController = (padIndex: number) => {
  let controller = allControllers.get(padIndex);
  if (!controller) {
    controller = createController();
    allControllers.set(padIndex, controller);
  }
  return controller;
};

const normalizeDuration = (duration: number) =>
  Number.isFinite(duration) ? Math.max(0, duration) : 0;

export function makeEffectStrict(effect: Effect | number): StrictEffect {
  if (typeof effect === 'number') {
    return {
      duration: normalizeDuration(effect),
      strongMagnitude: 0,
      weakMagnitude: 0,
    };
  }

  return {
    duration: normalizeDuration(effect.duration),
    strongMagnitude: Math.min(1, Math.max(0, effect.strongMagnitude || 0)),
    weakMagnitude: Math.min(1, Math.max(0, effect.weakMagnitude || 0)),
  };
}

export function applyRumble(pad: RawGamepad, effect: StrictEffect) {
  if (!pad.vibrationActuator) {
    return Promise.reject(
      `Joymap rumble applyRumble: Gamepad ${pad.id} does not support haptic feedback`,
    );
  }

  try {
    return Promise.resolve(pad.vibrationActuator.playEffect('dual-rumble', effect));
  } catch (error) {
    return Promise.reject(error);
  }
}

export function resetRumble(pad: RawGamepad) {
  const actuator = pad.vibrationActuator;
  if (!actuator || typeof actuator.reset !== 'function') {
    return null;
  }

  try {
    return Promise.resolve(actuator.reset());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function clearRumble(padIndex: number) {
  return allControllers.delete(padIndex);
}

export function hasRumbleChannels(padIndex: number) {
  const controller = allControllers.get(padIndex);
  return !!controller && controller.channelsByOwner.size > 0;
}

export function registerRumbleOwner(padIndex: number, owner: RumbleOwner) {
  getController(padIndex).owners.add(owner);
}

export function requestRumbleRefresh(padIndex: number) {
  const controller = allControllers.get(padIndex);
  if (controller) {
    controller.needsRefresh = true;
  }
}

export function stopRumble(padIndex: number, channelName = defaultChannel, owner = defaultOwner) {
  const controller = allControllers.get(padIndex);
  const channels = controller?.channelsByOwner.get(owner);
  if (!controller || !channels || !channels.delete(channelName)) {
    return false;
  }

  if (channels.size === 0) {
    controller.channelsByOwner.delete(owner);
    if (owner === defaultOwner) {
      controller.owners.delete(owner);
    }
  }
  if (controller.owners.size === 0) {
    allControllers.delete(padIndex);
  }
  return true;
}

export function addRumble(
  padIndex: number,
  effect: Effect | Array<Effect | number>,
  channelName = defaultChannel,
  owner = defaultOwner,
) {
  const effects = (Array.isArray(effect) ? effect : [effect])
    .map(makeEffectStrict)
    .filter(({ duration }) => duration > 0);

  if (effects.length === 0) {
    stopRumble(padIndex, channelName, owner);
    return;
  }

  const controller = getController(padIndex);
  controller.owners.add(owner);
  let channels = controller.channelsByOwner.get(owner);
  if (!channels) {
    channels = new Map();
    controller.channelsByOwner.set(owner, channels);
  }
  channels.set(channelName, { cursor: 0, effects, elapsed: 0, updatedAt: performance.now() });
}

export function getCurrentEffect(padIndex: number): StrictEffect {
  let strongMagnitude = 0;
  let weakMagnitude = 0;
  const controller = allControllers.get(padIndex);

  if (controller) {
    for (const channels of controller.channelsByOwner.values()) {
      for (const channel of channels.values()) {
        const current = channel.effects[channel.cursor];
        strongMagnitude += current.strongMagnitude;
        weakMagnitude += current.weakMagnitude;
      }
    }
  }

  return {
    duration: MAX_DURATION,
    strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
    weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
  };
}

export function updateChannels(padIndex: number, now = performance.now()) {
  const controller = allControllers.get(padIndex);
  if (!controller) {
    return;
  }

  for (const [owner, channels] of controller.channelsByOwner) {
    for (const [channelName, channel] of channels) {
      let remaining = now - channel.updatedAt;
      channel.updatedAt = now;
      while (channel.cursor < channel.effects.length) {
        const effect = channel.effects[channel.cursor];
        const effectRemaining = effect.duration - channel.elapsed;
        if (remaining < effectRemaining) {
          channel.elapsed += remaining;
          break;
        }

        remaining -= Math.max(0, effectRemaining);
        channel.cursor += 1;
        channel.elapsed = 0;
      }

      if (channel.cursor === channel.effects.length) {
        channels.delete(channelName);
      }
    }

    if (channels.size === 0) {
      controller.channelsByOwner.delete(owner);
      if (owner === defaultOwner) {
        controller.owners.delete(owner);
      }
    }
  }

  if (controller.owners.size === 0) {
    allControllers.delete(padIndex);
  }
}

export function updateRumble(pad: RawGamepad, owner: RumbleOwner) {
  registerRumbleOwner(pad.index, owner);
  const now = performance.now();
  updateChannels(pad.index, now);
  const controller = allControllers.get(pad.index)!;
  if (!pad.vibrationActuator?.playEffect) {
    return;
  }
  const current = getCurrentEffect(pad.index);
  const active = current.strongMagnitude > 0 || current.weakMagnitude > 0;

  if (
    controller.needsRefresh ||
    controller.lastStrongMagnitude !== current.strongMagnitude ||
    controller.lastWeakMagnitude !== current.weakMagnitude ||
    (active && now - controller.lastAppliedAt >= MAX_DURATION / 2)
  ) {
    void applyRumble(pad, current).catch(() => undefined);
    controller.lastAppliedAt = now;
    controller.lastStrongMagnitude = current.strongMagnitude;
    controller.lastWeakMagnitude = current.weakMagnitude;
    controller.needsRefresh = false;
  }
}

export function releaseRumbleOwner(pad: RawGamepad, owner: RumbleOwner) {
  const controller = allControllers.get(pad.index);
  if (!controller || !controller.owners.delete(owner)) {
    return;
  }

  const hadChannels = controller.channelsByOwner.delete(owner);
  if (controller.owners.size === 0) {
    allControllers.delete(pad.index);
  } else if (hadChannels) {
    controller.needsRefresh = true;
  }

  if (hadChannels) {
    const reset = resetRumble(pad);
    if (reset) {
      void reset.catch(() => undefined);
    }
  }
}
