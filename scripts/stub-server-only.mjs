// `server-only` throws outside a React Server environment. The social tick (scripts/social-tick.ts) is plain
// Node, so this preload makes that marker import a no-op (same idea as tests/stubs/server-only.ts).
import Module from 'node:module';

const load = Module._load;
Module._load = function (request, ...rest) {
  const name = String(request).split('\\').join('/');
  return name === 'server-only' || name.includes('/server-only/')
    ? {}
    : load.call(this, request, ...rest);
};
