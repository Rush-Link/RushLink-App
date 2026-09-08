# HeadRush file API capability audit

Captured from a HeadRush Flex Prime running firmware `5.1.0.2a63755`.

## Verified result

The reflected API can persist supported HeadRush content through dedicated
object methods. It does not expose a general-purpose file read/write API.

| Capability | API | Live result |
| --- | --- | --- |
| List folders and filtered filenames | `FileAccess.ls(path, fileType)` | Confirmed |
| Read setlist data | `Setlists.getSetlist(id)` | Confirmed; returns normalized JSON |
| Create/update a setlist file | `Setlists.saveSetlist(json, saveAsName)` | Confirmed |
| Delete a setlist file | `Setlists.deleteSetlist(id)` | Confirmed |
| Serialize an effect block temporarily | `Blocks.serializeBlock(module, doubled)` | Advertised and used by the editor |
| Restore serialized block state | `Blocks.deserializeBlock(module, doubled, data)` | Advertised and used by the editor |
| Create typed presets | Blocks, Drum Machine and MIDI Out methods | Advertised |
| Save/load rigs | `Rigs` methods | Advertised and used by the editor |
| Download supported cloud content | HeadRush Cloud and Tone3000 methods | Advertised; destination is device-controlled |
| Read arbitrary user-file bytes | None | Not exposed |
| Write arbitrary bytes/path/extension | None | Not exposed |
| Download a Practice Tool or Loop audio file over HTTP | None | Not exposed |
| Upload a Practice Tool or Loop audio file over HTTP | None | Not exposed |

## Disposable persistence test

A uniquely named empty setlist was created using the exact call shape from the
deployed Remote Editor, located in the reflected setlist index, read back using
its device-generated UUID, and deleted. A final subtree read confirmed deletion;
the currently loaded `Plays` setlist did not change.

The new-setlist call shape is:

```http
POST /api/v1/object-method/Evil/API/Setlists/saveSetlist
Content-Type: application/json

{
  "arguments": [
    "{\"id\":\"<client UUID>\",\"name\":\"\",\"data\":[]}",
    "<unique save-as name>"
  ]
}
```

The device returns a new UUID rather than retaining the client-provided one.
That returned UUID is used by `getSetlist` and `deleteSetlist`.

A second disposable test used a save-as name ending in `.txt` and included an
unknown JSON field. `FileAccess.ls("Setlists", 5)` showed the physical filename
ending in `.txt.setlist`, and `getSetlist` omitted the unknown field. This proves
that the handler forces its proprietary extension and normalizes content; it is
not a disguised arbitrary-file write primitive. Cleanup was again verified.

A third disposable test placed a small opaque RushLink marker in the recognized
`author` field and supplied a custom `version`. Read-back normalized these to an
empty author and version `1.0.0`; neither value survived. Cleanup was verified.
Consequently, setlist JSON cannot safely carry RushLink workspace settings even
through apparently legitimate metadata fields.

An earlier call with the save-as name placed in the wrong JSON field returned an
empty identifier. Both the reflected index and `FileAccess.ls` confirmed that it
created no file.

## NAM destination verification

The connected Flex Prime was checked again on 2026-09-08. Its NAM root contains
`User`, `Tone 3000`, and `HeadRush Cloud`; `User` also contains nested folders.
The Tone3000 object still exposes only `downloadModelToDevice(id, url, name)`.

A download with `../User/<model name>` returned a `success: true` envelope but
created no listed NAM in either `User` or `Tone 3000`. The same model ID and URL
with a plain model name immediately created the expected `.nam` in `Tone 3000`.
The active NAM selection remained unchanged. A success envelope alone therefore
does not establish that a requested custom folder was used.

RushLink supports other NAM destinations through USB Transfer: download and verify
the source in `Tone 3000`, then copy it into an existing folder under the mounted
`Neural Amp Modeler` directory selected by the user. The native copy command is
restricted to that dialog-authorized NAM directory, refuses to overwrite files,
and keeps the original. The user must eject the drive and tap Sync on HeadRush
after copying. This does not add a general-purpose network file-write route.

## Read boundary

`FileAccess.ls` enumerates a real audio file beneath `Practice Tool`, but the
public HTTP file router cannot return its bytes. Tested mappings beneath
`/files/Evil/Practice Tool`, `/files/Evil/User`, `/files/Evil/Content`,
`/files/HeadRush`, `/files/HG12`, and `/files/Practice Tool` all returned 404.

Unadvertised `FileAccess` methods named `stat`, `exists`, `read`, `get`, `open`,
`readFile`, `download`, and `downloadFile` also returned 404. The reflected
metadata still advertises only `ls`.

## HTTP boundary

`/files/Evil/Web` is a public GET-only asset router for the Remote Editor. It is
not mapped to device user content. HEAD and OPTIONS requests returned 405 for the
web root, known files, reflection routes, and nonexistent probe targets. The web
server did not advertise an upload verb or an `Allow` header.

No speculative PUT was sent to the public web directory: if an undocumented PUT
had unexpectedly succeeded, the API provides no corresponding delete operation
and the probe could have left an undeletable file in the installed editor.

## RushLink policy

RushLink may use typed persistence only when it understands and validates the
specific HeadRush format and can identify and delete or restore the exact object.
It must not present `FileAccess.ls` as file download, expose guessed raw upload
controls, or treat setlists/presets as general backup storage. Encoding app state
into visible setlist names, rig ordering, MIDI messages, or dummy presets is also
prohibited: it would pollute user libraries, provide little capacity, and depend
on undocumented normalization behavior.
