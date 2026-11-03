## Contributing

1. Please read our [Code of Conduct](CODE_OF_CONDUCT.md)
1. Please create a new issue [here](https://github.com/forcedotcom/cli/issues) before starting any work so that we can also offer suggestions or let you know if there is already an effort in progress.
1. Sign the Salesforce [CLA](#cla).
1. Fork this repository.
1. [Build the plugin locally](#build)
1. The CLI team will review your pull request and provide feedback.
1. Once merged, a new release of the `plugin-service-automation` plugin will be published to [npm](https://www.npmjs.com/package/@salesforce/plugin-service-automation).

### CLA

External contributors are required to sign a Contributor License
Agreement. You can do so by going to https://cla.salesforce.com/sign-cla.

## Build

```bash
git clone git@github.com:salesforcecli/plugin-service-automation
cd plugin-service-automation
yarn && yarn build
```

Run commands locally:

```bash
./bin/dev service-process list -o YOUR_ORG
```

Or link the plugin and use `sf`:

```bash
sf plugins link .
sf service-process list -o YOUR_ORG
```

## Branches

- We work in branches off of `main`.
- Our release (aka. _production_) branch is `main`.
- Our work happens in _topic_ branches (feature and/or bug-fix).
  - Feature as well as bug-fix branches are based on `main`
  - Branches _should_ be kept up-to-date using `rebase`
  - Commit messages follow Conventional commits format

## Pull Requests

- Develop features and bug fixes in _topic_ branches off main, or forks.
- _Topic_ branches can live in forks (external contributors) or within this repository (internal contributors).
  - When creating _topic_ branches in this repository please prefix with `<initials>/`. For example: `mb/refactor-tests`.
- PRs will be reviewed and merged by the CLI team.

## Releasing

- A new version of this plugin (`plugin-service-automation`) will be published upon merging PRs to `main`, with the version number increment based on commitizen rules.
