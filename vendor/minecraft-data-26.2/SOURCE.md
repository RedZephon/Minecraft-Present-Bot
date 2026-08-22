# Vendored Minecraft 26.2 protocol data

Copied verbatim from PrismarineJS/minecraft-data branch `pc_26_2`
(PR #1219, "Add Minecraft pc 26.2 data") at commit `4dd8762a45b97dafdb216b8d7a95ab92379e2c68`.

| File | Upstream path |
|---|---|
| `protocol.json` | `data/pc/26.2/protocol.json` |
| `version.json` | `data/pc/26.2/version.json` |
| `dataPaths.pc.26.2.json` | the `pc["26.2"]` object from `data/dataPaths.json` |

26.2 is protocol **776**. Everything except `protocol` and `version` reuses
26.1's data set, which is exactly what upstream does.

`scripts/patch-mc-data-26.2.js` injects these into the installed
`minecraft-data` package on `postinstall`. Delete this directory, the script,
and the postinstall hook once `minecraft-data` ships 26.2 on npm — the script
already no-ops when it detects real 26.2 support.
