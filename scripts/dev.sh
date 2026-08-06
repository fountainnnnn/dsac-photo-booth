#!/bin/sh
# Dev-server launcher for tools that spawn without a login shell (so nvm's
# PATH edit in ~/.zshrc never runs). Points at the nvm-installed Node 22.
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
# Preview launchers inject PORT for the page they expect (5173, Vite). The
# Express server also reads PORT and would steal Vite's port with it — pin it
# back to the backend's own port so the proxy target stays true.
export PORT=3001
exec npm run dev
