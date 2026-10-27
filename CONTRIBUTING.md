# Contributing

Thanks for helping. Read [`AGENTS.md`](AGENTS.md) first: it holds the development rules (i18n for every UI string, low-spec hardware, mobile-first UI, manual and bot updates).

1. Fork and create a branch.
2. Make the change, with tests.
3. Run `npm run check` (typecheck and tests). It must pass.
4. If you change what players, hosts or operators see, update the matching file in `docs/manual/`.
5. Open a pull request describing what changed and why.

New games are packs (`docs/development/game-packs.md`) and new features are plugins (`docs/development/plugins.md`).
By contributing you agree that your work is released under the [MIT licence](LICENSE).
