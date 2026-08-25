#!/bin/sh
set -eu

node ./node_modules/typeorm/cli.js migration:run -d ./build/lib/typeorm-cli.js

exec node ./build/server.js
