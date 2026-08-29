# Joymap

**Joymap** is a modern browser Gamepad API wrapper and input mapping library. It provides deterministic polling, controller assignment, button and stick mappings, press and release transitions, rebinding helpers, and rumble support through a small TypeScript API.

### Features

- **Game-loop friendly:** Poll input exactly where your game needs it, or let Joymap run its own `requestAnimationFrame` loop.
- **Flexible mappings:** Give physical buttons and sticks logical names, combine inputs, and rebind them at runtime.
- **Responsive controls:** Read analog values and input transitions with configurable thresholds, deadzones, hysteresis, and clamping.
- **Multiple controllers:** Support identical devices by `Gamepad.index`, with shared snapshots for efficient polling.

### Input without a DSL

The browser Gamepad API exposes sampled state rather than semantic events. Joymap follows that model: poll once at the beginning of an update, then read the controller state your game needs. There is no event expression language, observable layer, or hidden scheduler.

Your application remains responsible for translating physical input into game actions. This keeps focus handling, input repetition, menus, gameplay rules, and other domain behavior in the application where they belong.

```ts
joymap.poll();

const accept = player.getButton('A');
if (isJustPressed(accept)) {
  openSelectedItem();
}
```

## Getting Started

Install Joymap with pnpm:

```bash
pnpm add @nkzw/joymap
```

Create a Joymap instance and one controller per local player:

```ts
import { createController, createJoymap, isJustPressed } from '@nkzw/joymap';

const player1 = createController();
const player2 = createController();

const joymap = createJoymap({ autoConnect: true });
joymap.addController(player1);
joymap.addController(player2);

function update() {
  joymap.poll();

  const accept = player1.getButton('A');
  if (isJustPressed(accept)) {
    console.log('Player 1 pressed A');
  }

  const movement = player1.getStick('L');
  if (movement.pressed) {
    movePlayer(movement.value[0], movement.value[1]);
  }

  requestAnimationFrame(update);
}

requestAnimationFrame(update);
```

Call `poll()` at the beginning of a game-owned update loop for the lowest and most predictable input latency. If your application does not already have a loop, pass `onPoll` and call `start()` instead:

```ts
const joymap = createJoymap({
  autoConnect: true,
  onPoll: () => {
    if (isJustPressed(player1.getButton('start'))) {
      openMenu();
    }
  },
});

joymap.addController(player1);
joymap.start();

// Later:
joymap.stop();
```

## Core Concepts

Joymap has two public runtime primitives: a `Joymap` polls the browser and coordinates physical devices, while a `Controller` maps one physical gamepad to logical inputs for one player.

### Joymap

Create a Joymap instance with `createJoymap(options?)`:

```ts
const joymap = createJoymap({
  autoConnect: true,
  onPoll: () => updateGamepadInput(),
});
```

`JoymapOptions` supports:

- `autoConnect?: boolean` assigns each unassigned controller to an unused gamepad when one is available. The default is `false`.
- `onPoll?: () => void` runs after every poll, including the poll where the final gamepad disconnects. The default is a no-op.

A `Joymap` exposes:

- `addController(controller)` registers a controller and returns it. Registering the same controller again has no effect.
- `removeController(controller)` destroys and unregisters a controller. It returns whether the controller was registered.
- `clearControllers()` destroys and unregisters every controller.
- `getControllers()` returns a readonly snapshot of the registered controllers.
- `getGamepads()` returns the readonly list of connected, valid browser `Gamepad` objects from the latest poll.
- `getUnusedGamepadIndex()` returns the first connected gamepad index that is not assigned to a controller.
- `getUnusedGamepadIndexes()` returns every connected gamepad index that is not assigned to a controller.
- `poll()` samples the browser Gamepad API, updates every controller, and invokes `onPoll`.
- `start()` polls with `requestAnimationFrame`. It is idempotent and automatically resumes when a gamepad connects.
- `stop()` stops automatic polling immediately, including when called from `onPoll`.

### Controllers

Create a controller with `createController(options?)`:

```ts
const controller = createController({
  buttonThreshold: 0.2,
  gamepadIndex: 0,
  stickDeadzone: 0.2,
});
```

`ControllerOptions` supports:

- `buttonThreshold?: number` sets the button press threshold in the inclusive range `[0, 1]`. The default is `0.2`.
- `buttonReleaseThreshold?: number` sets the lower release threshold used for button hysteresis. The default is `buttonThreshold - 0.05`, clamped to `0`.
- `stickDeadzone?: number` sets the radial stick press deadzone in the inclusive range `[0, 1]`. The default is `0.2`.
- `stickReleaseDeadzone?: number` sets the lower release deadzone used for stick hysteresis. The default is `stickDeadzone - 0.05`, clamped to `0`.
- `clampThreshold?: boolean` returns zero values for inputs below their active threshold. The default is `true`.
- `rescaleSticks?: boolean` rescales radial stick output after the deadzone so it transitions from zero and still reaches full magnitude. The default is `false`.
- `gamepadIndex?: number` reserves a non-negative `Gamepad.index` for this controller.

Thresholds must be finite values between `0` and `1`. Release thresholds cannot exceed their corresponding press thresholds.

## Controller Assignment

Joymap identifies live controller slots by `Gamepad.index`. `Gamepad.id` is descriptive product metadata and is not guaranteed to be unique. The [Gamepad specification](https://www.w3.org/TR/gamepad/) allows a disconnected index to be reused by the next gamepad that connects, whether it is the same physical device or a different one.

```ts
controller.assign(2);

controller.getGamepadIndex(); // 2
controller.isConnected(); // false until gamepad 2 is observed in a poll

joymap.addController(controller);
joymap.poll();

controller.isConnected(); // true when gamepad 2 is connected
controller.getGamepad(); // the live Gamepad, or null
```

An assignment remains reserved when its gamepad disconnects. If that index becomes available again, the gamepad occupying the slot is assigned to the same player. Call `unassign()` to release the slot. When `autoConnect` is enabled, an unassigned controller can receive another unused gamepad during the next poll.

Controller assignment APIs:

- `assign(gamepadIndex)` reserves a non-negative gamepad index.
- `unassign()` disconnects the current gamepad and releases its assignment.
- `getGamepadIndex()` returns the assigned index or `null`.
- `getGamepad()` returns the currently connected browser `Gamepad` or `null`.
- `isConnected()` reports whether the assigned gamepad was present during the latest poll.

## Reading Inputs

Joymap installs the standard browser mapping only when `gamepad.mapping === 'standard'`. Its built-in logical buttons are `A`, `B`, `X`, `Y`, `L1`, `L2`, `L3`, `R1`, `R2`, `R3`, `dpadUp`, `dpadDown`, `dpadLeft`, `dpadRight`, `select`, `start`, and `home`. The built-in sticks are `L` and `R`.

Nonstandard gamepads require explicit mappings. Missing inputs and disconnected controllers return independent neutral results instead of throwing.

### Buttons

```ts
const button = controller.getButton('A');
// {
//   justChanged: boolean,
//   pressed: boolean,
//   type: 'button',
//   value: number,
// }

const { A, B } = controller.getButtons('A', 'B');
const allButtons = controller.getAllButtons();
```

- `getButton(name)` returns one `ButtonResult`.
- `getButtons(...names)` returns the requested results keyed by name.
- `getAllButtons()` returns every currently mapped button. Its result is partial because a controller may be disconnected or nonstandard.

`pressed` combines the browser's native `GamepadButton.pressed` state with Joymap's analog threshold and hysteresis. `value` is the highest value among the mapped physical buttons. `justChanged` is true for exactly one Joymap poll when `pressed` changes.

### Sticks

```ts
const stick = controller.getStick('L');
// {
//   inverts: readonly boolean[],
//   justChanged: boolean,
//   pressed: boolean,
//   type: 'stick',
//   value: number[],
// }

const { L, R } = controller.getSticks('L', 'R');
const allSticks = controller.getAllSticks();
```

- `getStick(name)` returns one `StickResult`.
- `getSticks(...names)` returns the requested results keyed by name.
- `getAllSticks()` returns every currently mapped stick. Its result is partial because a controller may be disconnected or nonstandard.

Stick significance is radial. When multiple physical sticks are grouped under one name, Joymap averages the active sticks.

### Transitions

`isJustPressed(input)` and `isJustReleased(input)` work with button or stick results and safely accept `undefined`:

```ts
if (isJustPressed(controller.getButton('A'))) {
  jump();
}

if (isJustReleased(controller.getButton('R2'))) {
  stopCharging();
}
```

Reading the same input multiple times during one poll returns the same transition semantics. A transition expires on the next Joymap poll.

## Mapping Inputs

Logical input names must be nonempty and alphanumeric. Physical indexes must be non-negative integers.

### Buttons

Map one physical button or group multiple buttons under one logical name:

```ts
controller.setButton('jump', [0]);
controller.setButton('confirm', [0, 1]);
```

- `setButton(name, indexes)` creates or replaces a button mapping.
- `swapButtons(firstName, secondName)` swaps two existing mappings.
- `getButtonIndexes(...names)` returns the deduplicated physical indexes for the named mappings.

A grouped button is pressed when any mapped physical button is pressed.

### Sticks

Each inner array describes the axes of one physical stick. Multiple inner arrays group multiple physical sticks into one logical result:

```ts
controller.setStick('move', [[0, 1]]);
controller.setStick(
  'combined',
  [
    [0, 1],
    [2, 3],
  ],
  [false, true],
);
```

- `setStick(name, indexGroups, inverts?)` creates or replaces a stick mapping.
- `invertSticks(inverts, ...names)` replaces the inversion flags for existing sticks.
- `swapSticks(firstName, secondName, includeInverts?)` swaps two stick mappings. Inversion flags remain with their logical names unless `includeInverts` is true.
- `getStickIndexes(...names)` returns the deduplicated physical axis groups for the named mappings.

All index groups in one stick mapping must contain the same nonzero number of axes. The inversion array must match that axis count.

## Rebinding

Joymap can wait for sustained physical input and report the matching indexes:

```ts
controller.listenButton((indexes) => controller.setButton('jump', indexes), 1, {
  waitFor: [2, 'polls'],
});

controller.listenAxis((indexGroups) => controller.setStick('move', indexGroups), 2, {
  consecutive: true,
  waitFor: [100, 'ms'],
});
```

- `listenButton(callback, quantity?, options?)` listens for a number of active buttons. The default quantity is `1` and default wait is one poll.
- `listenAxis(callback, quantity?, options?)` listens for a number of active axes. The default quantity is `2` and default wait is `100ms`.
- `cancelListen()` cancels the current button or axis listener.

Listener options are:

- `allowOffset?: boolean` permits a group to begin at an index that is not aligned to its quantity. The default is `true`.
- `consecutive?: boolean` requires adjacent indexes. The default is `false` for buttons and `true` for axes.
- `waitFor?: [number, 'polls' | 'ms']` requires the input to remain active for a poll count or monotonic duration.

The higher-level helpers apply a captured binding directly:

- `buttonBindOnPress(name, callback, allowDuplication?)` binds a logical button. By default, an existing physical mapping is swapped rather than duplicated. The callback receives the previous logical name when one existed.
- `stickBindOnPress(name, callback, allowDuplication?)` provides the equivalent behavior for sticks.

## Rumble

Rumble effects use the browser's `GamepadHapticActuator` when available:

```ts
controller.addRumble({
  duration: 120,
  strongMagnitude: 0.8,
  weakMagnitude: 0.3,
});
```

An effect object supports:

- `duration: number` in milliseconds.
- `strongMagnitude?: number` in the range `[0, 1]`.
- `weakMagnitude?: number` in the range `[0, 1]`.

Pass an array to create a timeline. Numbers represent pauses in milliseconds:

```ts
controller.addRumble(
  [{ duration: 50, strongMagnitude: 1 }, 100, { duration: 80, weakMagnitude: 0.5 }],
  'damage',
);
```

Named channels run concurrently and their magnitudes are combined:

- `addRumble(effectOrTimeline, channelName?)` starts or replaces a channel. The default channel name is `default`.
- `stopRumble(channelName?)` stops and resets a channel.
- `isRumbleSupported(gamepad?)` returns whether the supplied or connected gamepad supports rumble, or `null` when neither exists.

Rumble actuator promise rejections are handled internally. Queues are released when controllers are unassigned, removed, or physically disconnected.

## Public Types

Joymap exports these public TypeScript types:

- `Joymap` and `JoymapOptions`
- `Controller` and `ControllerOptions`
- `Button`, `Stick`, `ButtonResult`, `StickResult`, and `InputResult`
- `Effect` and `EffectObject`
- `RawGamepad`, `CustomGamepad`, and `GamepadSnapshots`

`RawGamepad` is an alias for the browser's `Gamepad` type. `CustomGamepad` and `GamepadSnapshots` describe Joymap's normalized snapshot representation and are primarily useful for integrations and tooling.

## Migrating from v4

Joymap 5 replaces the old module terminology with a single controller abstraction. There are no compatibility aliases.

| v4                            | v5                                                 |
| ----------------------------- | -------------------------------------------------- |
| `createQueryModule()`         | `createController()`                               |
| `QueryModule`                 | `Controller`                                       |
| `BaseParams`                  | `ControllerOptions`                                |
| `joymap.addModule(module)`    | `joymap.addController(controller)`                 |
| `joymap.removeModule(module)` | `joymap.removeController(controller)`              |
| `joymap.clearModules()`       | `joymap.clearControllers()`                        |
| `joymap.getModules()`         | `joymap.getControllers()`                          |
| `getUnusedPadIndex()`         | `getUnusedGamepadIndex()`                          |
| `getUnusedPadIndexes()`       | `getUnusedGamepadIndexes()`                        |
| `padIndex`                    | `gamepadIndex`                                     |
| `controller.connect(index)`   | `controller.assign(index)`                         |
| `controller.getPadIndex()`    | `controller.getGamepadIndex()`                     |
| `controller.getPadId()`       | `controller.getGamepad()?.id ?? null`              |
| `controller.disconnect()`     | `controller.unassign()` for an intentional release |

The deprecated `padId`, shared `threshold`, `getUnusedPadId()`, and `getUnusedPadIds()` APIs were removed. Use unique gamepad indexes, and configure `buttonThreshold` and `stickDeadzone` separately.

`createBaseModule`, `BaseModule`, `AnyModule`, and the mapper registry were also removed from the public API. A mapper was only a stored function receiving the controller; replace it with an ordinary function:

```ts
// v4
controller.setMapper('accept', (module) => module.getButton('A'));
const accept = controller.getMapper('accept');

// v5
const getAccept = (controller: Controller) => controller.getButton('A');
const accept = getAccept(controller);
```

`isConnected()` now means that a live gamepad was observed during the latest poll. Assigning an index does not report a physical connection until Joymap sees that device. Use `getGamepadIndex()` to inspect assignment and `getGamepad()` for live device metadata.

`getAllButtons()` and `getAllSticks()` now correctly return partial records because mappings may be absent before the first standard gamepad poll or on nonstandard devices.

A typical migration looks like this:

```ts
import { createController, createJoymap, isJustPressed, type Controller } from '@nkzw/joymap';

const controller: Controller = createController();
const joymap = createJoymap({ autoConnect: true });

joymap.addController(controller);
joymap.poll();

if (isJustPressed(controller.getButton('A'))) {
  accept();
}
```

## Development

Install dependencies and run the full validation suite with Vite+:

```bash
vp install
vp run test:all
```

Run the local Signal Strike gamepad demo with:

```bash
vp run demo
```

Run performance and retained-memory benchmarks with:

```bash
vp run benchmark:all
```
