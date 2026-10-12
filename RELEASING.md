# Releasing

Releases are cut from `main` with one command. A pushed `v*` tag makes the [Release workflow](.github/workflows/release.yml) build every platform into a **draft** GitHub Release whose notes come from `CHANGELOG.md`. You review the draft and publish it.

## While you work

- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `ci:`, `chore:`. Mark breaking changes with `!` (`feat!: …`) or a `BREAKING CHANGE:` line in the body.
- Add user-facing notes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Write them for people using the app, not for reviewers.

If `## [Unreleased]` is empty at release time, the notes are generated from `feat`, `fix`, `perf`, `refactor` and `revert` commits since the last tag.

## Cutting a release

```bash
bun run release --dry-run    # preview the version and notes; writes nothing
bun run release              # bump, roll the changelog, commit, tag
git push --atomic origin main v0.2.0
```

Without a bump argument the version is worked out from the changes: a breaking change bumps major (minor before 1.0), a `feat` commit or an `### Added` section bumps minor, anything else bumps patch. To choose it yourself:

```bash
bun run release minor        # patch | minor | major
bun run release 1.0.0-beta.1 # an exact version; a "-" suffix publishes as a pre-release
bun run release minor --push # also push, which starts the build
```

The script stops unless you're on a clean `main` that is up to date with `origin`, and it runs the typecheck before writing anything. It then:

1. Sets the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
2. Moves `## [Unreleased]` into a dated `## [x.y.z]` section and updates the compare links.
3. Commits `chore(release): vx.y.z` and creates an annotated tag `vx.y.z`.

To undo before pushing: `git tag -d vx.y.z && git reset --hard HEAD~1`.

## After pushing

1. Watch the Release workflow in the Actions tab. It checks the tag matches the app version, creates the draft with the changelog section as notes, and attaches the macOS, Windows, Linux and Android builds.
2. Open the draft release, check the assets, and publish.

Desktop builds also carry signed update bundles and a `latest.json` that the app's updater reads, so publishing a release is what offers it to everyone already on Otto. A draft or a pre-release is never offered; `/releases/latest` only points at a published, full release. The bundles are signed with the key in the `TAURI_SIGNING_PRIVATE_KEY` secret (plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has one; the current key has none, so that secret is unset); the matching public key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Without the secret the desktop jobs fail. **Keep a backup of the private key**: lose it and installed copies can never update again, since they only accept updates signed by it.

A local `bunx tauri build` needs the key too: `TAURI_SIGNING_PRIVATE_KEY=~/.tauri/otto-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD= bunx tauri build`.

Android builds are signed with the keystore in the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets. Without them the APK is signed with a throwaway key and can't update an earlier install.

## Other commands

```bash
bun run release check          # every manifest has the same version (CI runs this)
bun run release notes v0.1.0   # print one version's notes
bash scripts/icons.sh          # regenerate app icons from assets/icon.svg
```
