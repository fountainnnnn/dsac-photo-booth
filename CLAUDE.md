# Two photo booths, one repository

This repository holds two separate photo booth applications built on the same
base. They serve different events and are released separately, so a change
meant for one must not land in the other by accident.

| App | Branch | Used for |
| --- | --- | --- |
| **DSAC** photo booth | `main` | SP DSAC events. The live booth: laptop app and https://booth.spmsdsac.workers.dev |
| **Open House** photo booth | `open-house` | Open House. Runs on localhost only, never hosted. Split off `main` on 2026-09-29 |

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

## Running and deploying

The DSAC hosted booth deploys from `main`: `npm run build && npx wrangler
deploy`, then push `main`.

Open House is never hosted, and `open-house` has no Worker and no
`wrangler.jsonc`, so a deploy cannot run from it. It runs on the booth laptop
and is served from localhost (`npm run booth`, http://localhost:3001). Guests
download their photo the usual way: the server opens a Cloudflare tunnel at
startup and the QR code points at that public URL, so a phone on mobile data
can reach the laptop.

Run it from its own checkout of `open-house`, not by switching branches in the
DSAC folder: the local server keeps photos and settings in the checkout's
`data/` folder, and both booths listen on port 3001.

On `open-house` the package name, app id and product name are Open House's
own, and there is no updater and no `publish` target, so packaging it cannot
touch DSAC's releases. Still never run `npm version` there: its `v*` tags
would collide with DSAC's.
