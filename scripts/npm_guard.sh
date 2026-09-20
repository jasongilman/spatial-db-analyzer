#!/bin/bash
#
# Sourced by the scripts that call into frontend/ to make sure npm is on PATH.
#
# Node is installed through nvm, which a non-interactive shell does not pick up.
# Adds the known nvm bin directory if it exists, then fails with an actionable
# message rather than a bare "npm: command not found".

if ! command -v npm >/dev/null 2>&1; then
  nvm_bin="$HOME/.nvm/versions/node/v24.21.0/bin"
  if [ -d "$nvm_bin" ]; then
    export PATH="$nvm_bin:$PATH"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found on PATH." >&2
  echo "Node is installed through nvm; add it to PATH with:" >&2
  # shellcheck disable=SC2016  # the line is printed verbatim for the user to paste
  echo '  export PATH="/Users/jason/.nvm/versions/node/v24.21.0/bin:$PATH"' >&2
  exit 1
fi
