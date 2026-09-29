# Two photo booths, one repository

This repository holds two separate photo booth applications built on the same
base. They serve different events and are released separately, so a change
meant for one must not land in the other by accident.

| App | Branch | Used for |
| --- | --- | --- |
| **DSAC** photo booth | `main` | SP DSAC events. The live booth: laptop app and https://booth.spmsdsac.workers.dev |
| **Open House** photo booth | `open-house` | Open House. Split off `main` on 2026-09-29 |

**This checkout is: DSAC (`main`).**

## Before editing anything

1. Decide which app the task is for. "Open House" means the `open-house`
   branch; DSAC, "the booth" or anything already live means `main`. Ask if it
   is unclear.
2. Check the bold line above. Worktrees get generated branch names
   (`claude/…`, `feat/…`) that say nothing about which app they came from, so
   the line above is what tells you.
3. If this checkout is the other app, stop and say so before changing code.

## Moving a fix between the apps

A fix both apps need (camera, capture, phone remote, gallery) is made in the
app it was found in, then cherry-picked into the other. Never merge one branch
into the other wholesale: branding, frames, copy, settings and deploy config
differ on purpose.

## Deploying

The DSAC booth deploys from `main`: `npm run build && npx wrangler deploy`,
then push `main`.

Open House has no deploy targets of its own yet. Until these point at Open
House resources, they still point at DSAC's live ones:

- `wrangler.jsonc` — worker `name`, the D1 database and the R2 bucket
- `electron-builder.yml` — `appId`, `productName`, artifact names, `publish`
  repository (DSAC booths read their updates from its releases)
- `package.json` — `name`, which also names the `%APPDATA%` data folder, and
  `version`, whose `v*` git tags are DSAC's

So from `open-house`, do not run `npx wrangler deploy`,
`npm run package -- --publish always` or `npm version`: each would overwrite or
collide with the live DSAC booth.
