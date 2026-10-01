# Vendored Minecraft 26.2 data

The complete `data/pc/26.2/` directory from PrismarineJS/minecraft-data branch
`pc_26_2` at commit `68ea7b59e7aa318be86cf265be45ee1b79572528` — the state after
PR #1298 ("26.2") was merged into that branch. `dataPaths.pc.26.2.json` is the
`pc["26.2"]` row of `data/dataPaths.json` at the same commit.

26.2 is protocol **776**.

This replaces the earlier vendored copy (`4dd8762`, protocol and version only,
everything else borrowed from 26.1). That copy was an older draft: its `teams`
packet layout was wrong, and borrowing 26.1's registries meant every block
state from `calcite` upward decoded as the wrong block (26.2 added 28 blocks).

`scripts/patch-dependencies.js` injects these files into the installed
`minecraft-data` on `postinstall` and verifies the result. It no-ops once
`minecraft-data` ships 26.2 natively — at that point delete this directory.
