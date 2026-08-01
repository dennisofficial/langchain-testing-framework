# @dltech/ai-testing

## 1.0.1

### Patch Changes

- Add `@swc/core` as a devDependency so `tsup` can honour `emitDecoratorMetadata`. Without a resolvable `@swc/core`, tsup silently degrades `emitDecoratorMetadata` to a no-op warning instead of failing — this is the same root cause fixed in `@dltech/nestjs-core`'s `LoggerInterceptor` DI bug.

  This package doesn't currently decorate any class in its own source, so this build's output is unchanged — it's a defensive fix so a future decorated/DI class doesn't silently ship broken metadata the way `@dltech/nestjs-core` did.

## 1.0.0

### Major Changes

- First public release.

  Previously consumed as `@workspace/ai-testing` through a git submodule. The package now
  ships compiled type declarations from `dist` rather than pointing consumers at its
  TypeScript sources, and releases through CI with npm provenance.

  The version resets to 1.0.0 from the workspace-internal 3.4.0, which never reached a
  registry.
