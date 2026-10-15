# HeadRush firmware 5.2.0 compatibility

**RushLink 0.1.3 targets HeadRush firmware 5.2.0.** The app version and the pedal
firmware version are separate. See the [0.1.3 release notes](releases/0.1.3.md)
for the changes and early-alpha limitations.

RushLink has been exercised with a Flex Prime running `5.1.0.2a63755` and
`5.2.0.2a405ee`. This is a compatibility record for those devices and firmware
versions. Prime, Core, other firmware versions and every audio configuration
have not been independently verified. Use live reflection to determine support.

## Firmware changes relevant to RushLink

The official [5.2 update notes](https://cdn.inmusicbrands.com/Software/SGEE/52/READ%20ME%20-%20HeadRush%20Flex%20Prime%20Firmware%20Update%20Instructions%20v5.2.0.pdf)
and [5.2 user guide](https://cdn.inmusicbrands.com/Software/SGEE/52/HeadRush%20Flex%20Prime%20-%20User%20Guide%20-%20v5.2.0.pdf)
describe multiple A2 captures, input/output calibration, and NAM-related firmware
fixes. DSP fixes run on the pedal; RushLink reads the available controls.

The supported allocation is two independent NAM blocks, containing up to two
A2 Full captures or four A2 Lite captures through doubling. The second NAM block
is not a different model architecture. More than two A2 captures requires Lite.
The user guide also requires Lite when a stereo effect precedes two separate
NAM blocks. A1 supports one native capture and disables Full/Lite selection.

## Reflected controls

Firmware 5.2 adds `/Evil/Engine/Patch/Neural_Amp_Modeler_2` alongside
`/Evil/Engine/Patch/Neural_Amp_Modeler`. Resolve module IDs from the live module
table rather than relying on IDs from a previous capture.

| Property | Meaning |
| --- | --- |
| `Doubling` | Enable a second capture inside the same NAM block |
| `DoubleMode` | `false`: Stereo; `true`: Switch |
| `LoadedClone`, `LoadedClone2` | Primary and doubled capture files |
| `LightMode`, `LightMode2` | `false`: Full; `true`: Lite; respect `disabled` |
| `CalibrateInput`, `CalibrateInput2` | Input calibration, when the capture supports it |
| `OutputMode`, `OutputMode2` | `0`: Raw; `1`: Calibrated; `2`: Normalize |
| `Input2`, `Output2` | Doubled capture gain |
| `Gate2`, `Threshold2` | Doubled capture gate |
| `EQ2`, `Bass2`, `Middle2`, `Treble2` | Doubled capture EQ |
| `FileMissing2`, `PresetName2` | Doubled capture file/preset state |
| `Width`, `Balance` | Stereo doubling parameters |

Controls with reflected schema type `number` use normalized wire values and
reflected display metadata; integer and enum selectors use their direct values.
For example, a normalized `Balance` of `0.5` is centered. Do not send displayed
percentages or dB values directly as normalized values.

The legacy 5.1 normalization selector is `Normalize`. Use `OutputMode = 2` on
5.2 and retain the legacy selector only when live metadata advertises it.

## Editor and Test Rig Studio

The standard chain editor allocates an unused reflected NAM host for a second
NAM block. Each host has independent files and parameters. It reads back the
chain after allocation because reusing a module type can move an existing host.

Test Rig Studio stores the preferred model mode, audition NAM host and chain
position. Preferences include A2 Full, A2 Lite, A1 and other models. Lite is a
processing mode, not a separate downloadable file format. The audition uses the
chosen host's primary capture and preserves other configured captures.

The planner requests Lite above two A2 lanes, checks live disabled controls and
refreshes state after loading files. Known A1 models are rejected for a plan
that needs multiple captures. Unknown local file architectures remain subject
to the device's load result and reflected constraints.

Firmware 5.1 devices without the second host retain single-NAM behavior. See
[the device API guide](DEVICE-API.md) for transport and capability rules.

## Resource-limit findings

Temporary allocation experiments attempted three/four Full captures and a
fifth Lite capture. Full flags could sometimes be written even while their
controls remained disabled. CPU observations provided no verified evidence of
additional Full inference. Successful HTTP writes are not proof of the DSP mode.

Duplicating a NAM module type moved an existing instance; no third independent
host or third file selector appeared. Alternate clone loaders did not decode an
additional NAM capture. RushLink therefore enforces the verified two-host limit
and does not advertise a processing-limit bypass.

These checks did not establish audio fidelity, sustained playing CPU, mixed
A1/A2 behavior, calibrated-capture accuracy or audible Switch Doubling tails.
Use the official guide and current live metadata for those constraints.

## Tone3000 browser sign-in

The new reflected method is
`/Evil/API/Tone3000/startLoginGetAuthUrl()` with no reflected arguments. RushLink
offers it only when advertised and validates a nonempty HTTPS URL without
credentials on `tone3000.com` or a subdomain. The existing `startLogin` flow is
retained for devices that lack the method. The new response handling was tested
with simulated responses; the hardware session was already authenticated.

## Contributing firmware support

Add a minimal synthetic metadata fixture and a regression for the changed
behavior. Verify resulting state after writes and record the device/firmware
used. Do not commit full device subtrees, vendor editor bundles, model files,
account state or personal paths. Raw historical captures and one-off probing
scripts are kept outside the maintained source repository.

Run the focused NAM checks with:

```sh
npx vitest run src/domain/nam.test.ts src/stores/nam-firmware.test.ts src/pages/nam-ui.test.tsx
npx playwright test e2e/multiple-nam.spec.ts --workers=1
```
