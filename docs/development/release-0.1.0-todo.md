# 0.1.0 release: pending steps

State after the pre-publication review (2026-10-27): the sensitive-file cleanup, the Crash Bash rename, the 0.1.0 version bump,
the MIT licence fix and the release documents are done. Nothing is committed, pushed or tagged yet.

`npm run check` passes (typecheck and 1854 tests). On a fresh clone with another Node version, run `npm rebuild better-sqlite3` if the SQLite profile tests fail.

## To do
1. **`data/` and `bot/data/`**: left in place because the dev stack may use them. They hold profile codes (these work like passwords) and IPs. Git ignores them, but never copy or zip the project folder.
2. **`bot/reports/`** (8 GB, contains `/home/toni` paths): delete or move it. It is gitignored.
3. **GitHub owner and repo name**: replace `OWNER` / `<owner>/<repo>` in `docker-compose.prod.yml` (lines ~6, 36, 102), `README.md` (~245-265) and the link at the end of `CHANGELOG.md`. Add `repository`, `homepage`, `bugs` and `keywords` to `package.json` (keep `private: true`).
4. **Icons**: confirm the five files in `src/core/client/public/` (`icon-*.png`, `apple-touch-icon.png`, `icon.svg`) are your own work.
5. **`src/games/box-bonanza`**: compare it with Crash Bash's crate game (TNT and nitro crates) and rename anything copied.
6. **Check the rename** with `grep -rniE 'crash ?bash|uka uka|mad bomber|electro stun|polar (push|panic)' . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=reports`. Only `tasks.csv` may still match.
7. **Publish**:
   - `chown -R toni:toni .`
   - `git init`, then `git add -n .`: no `data/`, `.claude/`, `tasks.csv` or files over 1 MB.
   - Commit, create the GitHub repo, push, then `git tag v0.1.0 && git push --tags`.
   - Watch `release.yml`, `docker-image.yml` and `packages.yml`: they have not run yet.
   - Check that `packaging/build-package.sh` builds valid deb/rpm names for 0.1.0.

Decisions already made: rename all Crash Bash content; keep `iamdesvelao@gmail.com` as the public author email; ignore all agent/personal
files except `AGENTS.md`; plugins and packs follow the core version.
