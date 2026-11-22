# Changelog

## 1.0.13 — unreleased on npm

**Fixed**

- The browser bundle registered its factory as `@local/dsh-deferred-ask` instead of `dsh-deferred-ask`. DSH's `client-modules` rejects an entry whose id does not equal the package name, so `1.0.12` loaded nothing: the bar under the composer never appeared, while the Plugins page kept showing **active** (the Host half is an empty `apply()`). The id is now the package name.

**Added**

- `scripts/check-bundle-names.mjs`, wired into `prepublishOnly`, which refuses to publish unless `client.js`'s `__ModuleLoader__.load({ id })`, `cordis.patch.yml`'s `name`, and `package.json`'s `name` all agree. This is the class of bug that shipped silently in `1.0.12`.

**Docs**

- Both READMEs now open with a warning about `1.0.12`, install from the Git source, and explain how to fix an installation that already has the broken copy.

## 1.0.12 — broken, do not install

- Initial public release. Queues a question and delivers it only inside DeepSeek's off-peak pricing window.
- **Unusable**: the browser entry fails to load (see 1.0.13). Install `1.0.13` from the repository instead.
