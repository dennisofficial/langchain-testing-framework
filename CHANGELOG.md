# @dltech/ai-testing

## 1.1.0

### Minor Changes

- Compile eval modules with SWC so decorator metadata survives, and allow run-only modules.

  **Decorator metadata.** Modules were loaded through tsx, which compiles with esbuild — an ES
  decorators implementation that never emits `design:type`. Any project whose decorators read that
  metadata (Mongoose `@Prop`, NestJS DI, class-validator, `@dltech/nestjs-langchain`'s `@AiString` /
  `@AiToolCall`) threw `TypeError` at `Reflect.getMetadata` the moment a module was imported, which
  surfaced as errors like `Cannot determine a type for the "X.code" field`. TypeScript sources are
  now compiled by SWC with `legacyDecorator` + `decoratorMetadata`. tsx stays registered and still
  owns resolution, so tsconfig `paths` and extensionless specifiers behave as before.

  ESM and CommonJS are handled separately and deliberately: the ESM `load` hook returns transformed
  source only for ES modules, and hands CommonJS back to Node's own CJS loader where a
  require-extension compiles it. Returning source for `format: 'commonjs'` routes the file through
  Node's ESM→CJS translator, whose `require` is not fully wired, and any dependency it pulls in fails
  with `Cannot read properties of undefined (reading 'exports')`.

  **Run-only modules.** `evaluators: []` is now valid. A module with no golden answer exists to prove
  its chain still executes; it reports no metrics and fails only when a case throws. Rejecting it
  forced authors to invent a constant evaluator, which reports green while asserting nothing.
  `--check` and the run summary label these `run-only — no metrics`.

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
