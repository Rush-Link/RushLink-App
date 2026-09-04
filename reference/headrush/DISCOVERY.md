# HeadRush device discovery notes

Captured from `headrushflexprime.local` (`192.168.1.129`). The transposed hostname `headrushprimeflex.local` did not resolve during discovery.

## OpenAPI coverage

`tools/audit-headrush-openapi.js` performs a deep, order-independent comparison of the reflection snapshot and generated OpenAPI schemas.

Verified coverage:

- 291 reflection objects
- 7,783 reflected properties, including nested types, ranges, `x-options`, and `readOnly` flags
- 99 reflected methods, including argument and result schemas
- 3 optional objects and 6 methods found only in the frontend bundle

The optional `Mic`, `MicDryOut`, and `RigEncoder` objects currently return 404 and are marked `x-headrush-source: frontend-bundle` in OpenAPI. The bundle's dynamic `Pedal` base resolves to the reflected `Pedal1` and `Pedal2` objects.

## Downloadable HTTP assets

Confirmed and captured under `raw/device-assets/`:

- `/manifest.json`
- `/icon512.png`
- 132 block images from `/files/Evil/Web/Blocks/img/{block}.webp`
- 53 amp images from `/files/Evil/Web/Blocks/img/Amp/{amp}.webp`
- 15 cab images from `/files/Evil/Web/Blocks/img/Cab/{cab}.webp`
- 49 hashed fonts and editor images from `/static/media/`

All advertised/referenced assets downloaded successfully. See `raw/device-assets/download-report.json` for source URLs, filenames, byte counts, and HTTP statuses.

These conventional files were not exposed: source map, asset manifest, service worker, robots file, favicon, or version endpoint.

## Undocumented public file router

Route guessing identified JSON directory listing on paths that normally serve static files:

```text
GET /static
GET /static/{path}
GET /files/{client}/{path}
```

The only recognized client/root found was `Evil/Web`. Directory responses contain `name`, `type`, `mtime`, and file `size`; observed type codes are `1` for a file and `2` for a directory. The same route downloads file bytes when the target is a file.

A recursive GET-only crawl of `/static` and `/files/Evil/Web` found 12 directories and 483 downloadable entries (10,599,537 bytes), with no failed downloads. The mirror and full request/status inventory are stored in `raw/web-root-mirror/` and `web-file-crawl.json`.

This revealed the complete artwork inventory, beyond the subset referenced by the current bundle/subtree: 105 amp, 82 cab, and 51 microphone images. It also exposed `static/js/main.4a9a9934.js.LICENSE.txt`.

The subtree handler also accepts namespace prefixes that are not themselves objects, such as `/api/v1/subtree/Evil/API` and `/api/v1/subtree/Evil/Engine/Patch`. These confirmed namespace routes are generated into OpenAPI.

## Device content browser

The reflected read-only method below lists device content:

```http
POST /api/v1/object-method/Evil/API/FileAccess/ls
Content-Type: application/json

{"arguments":["",0]}
```

The root listing exposed these content categories:

```text
Amp Clones
Blocks
Drum Machine
Impulse Responses
Loops
Neural Amp Modeler
Practice Tool
Reverbs
Rigs
Setlists
Settings
SuperClones
```

The listing method can enumerate filenames using its file-type integer, but no direct HTTP GET mapping was found for those user-content files. Common `/files`, `/api/files`, and `/api/v1/files` mappings returned 404. Cloud upload/download functionality instead passes internal file paths to reflected object methods.

Dedicated object methods can persist validated HeadRush formats. A disposable
`Setlists.saveSetlist` -> `getSetlist` -> `deleteSetlist` round-trip was confirmed
on the live device, including final cleanup. A constrained extension/content
test showed that `.txt` is stored as `.txt.setlist` and unknown JSON fields are
discarded. This is typed setlist persistence, not arbitrary file storage. See
`FILE-CAPABILITIES.md` for the complete live-tested matrix and payload shape.

The Remote Editor bundle defines the integer argument as a file-type filter, not
a storage-provider selector:

```text
0 Folder             7 AmpClone
1 AnySupportedFile   8 SuperClone
2 IR                  9 NAMModel
3 Audio              10 AnyClone
4 Rig                11 MicSetting
5 Setlist            12 Reverb
6 Preset             13 MidiOutSetting
```

## Dropbox boundary

Dropbox was paired successfully through the Flex Prime's on-device File Browser,
then the complete reflection and public HTTP namespaces were captured again. The
paired state did not add or change any Dropbox, Practice Tool, Looper, storage,
authentication, upload, or download object. `/Evil/API/FileAccess` still exposed
only `ls(path, fileType)`.

The complete 483-file public web mirror and deployed Remote Editor bundle contain
no Dropbox, OAuth, cloud-storage-provider, or remote-storage client. The only
file wrapper in the editor calls `FileAccess.ls`; it has no user-file read, write,
upload, or delete counterpart.

Post-login GET checks confirmed that `/files/Evil/Web` remains the only public
file client. `/files/Dropbox`, `/files/Evil/Dropbox`, `/files/Evil/Loops`,
`/files/Evil/Practice Tool`, `/files/User`, `/files/External`, `/api/v1/files`,
`/api/v1/dropbox`, and `/api/v1/storage` all return 404. `FileAccess.ls` also
returns no Dropbox root for any defined file-type filter.

Conclusion: Dropbox support belongs to the device's local File Browser workflow
and is not exposed to the Remote Editor API in firmware `5.1.0.2a63755`. RushLink
must not claim Dropbox browsing or inject downloaded audio into the hardware
Looper/Practice Tool unless a future firmware advertises a genuine transfer and
load interface.

## Device audio metering

Firmware `5.1.0.2a63755` does not expose an audio amplitude, level-meter,
RMS, peak, or dBFS value through its reflected API. The closest-looking
properties are controls rather than measurements: input gain, rig volume,
mix levels, effect levels, and gate thresholds. `CPUMeter/CPUTimeSmoothed`
measures processor load and must not be treated as audio level.

The result was checked against the complete live subtree, plausible hidden
meter object paths, and the live WebSocket event stream. While the device's
built-in drum engine was producing audio, the stream emitted CPU meter
updates only. A TCP scan also found no separate metering service beyond the
known SSH, HTTP, and local name-resolution ports.

RushLink therefore does not fall back to a microphone, USB interface, CPU
load, or editable gain value. Its device-meter detector remains ready to use
a genuine numeric meter field if another firmware exposes one; only then does
it calculate a rolling RMS and held peak from device-originated samples.
