# Non-unit tests (NUTs)

Uses Mocha and [`@salesforce/cli-plugins-testkit`](https://github.com/salesforcecli/cli-plugins-testkit). See the [Salesforce CLI Plugin Developer Guide](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/test-plugin.html).

## Run

```bash
yarn compile   # or yarn build — NUTs use bin/run.js + compiled lib/
yarn test:nuts
```

Single file:

```bash
yarn mocha "test/nuts/service-process/list.nut.ts" --timeout 600000
```

## Smoke NUTs

`TestSession` uses **`devhubAuthStrategy: 'NONE'`** — no real org. Covers `--help`, missing required flags, invalid values (parse-time), and unknown `service-process` subcommand (`list.nut.ts`).

## Files

| File                                         | Command                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `service-process/list.nut.ts`                | `sf service-process list`                                                 |
| `service-process/deploy.nut.ts`              | `sf service-process deploy`                                               |
| `service-process/retrieve.nut.ts`            | `sf service-process retrieve`                                             |
| `service-process/service-process-org.nut.ts` | Real org: `list` / optional `retrieve`, `deploy`, E2E (env-driven, below) |

## Org NUTs (`service-process-org.nut.ts`)

**Skipped** unless **`TESTKIT_ORG_USERNAME`** is set. Default CI jobs should **leave it unset** so these tests do not run.

Use an org that has **Unified Catalog** (add-on/licensing and user access) as needed for `service-process` commands.

| Env var                      | Used for                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TESTKIT_ORG_USERNAME`       | **Required** — alias/username for the target org (testkit does not create a scratch org when this is set). Enables **list**.                                                 |
| `TESTKIT_SERVICE_PROCESS_ID` | **Retrieve** (`01t…`; skipped if unset).                                                                                                                                     |
| `TESTKIT_DEPLOY_INPUT_ZIP`   | **Deploy** and **E2E** — path to zip (cwd-relative OK); skipped if unset or file missing. API version must match org — see `test/fixtures/service-process-deploy/README.md`. |
| `SERVICE_PROCESS_NUT_E2E`    | Set `1` / `true` / `yes` for **deploy → list → retrieve** (needs zip).                                                                                                       |

The E2E suite logs a **one-line** summary after deploy step 1 (org, zip, `serviceProcess.id`, name, `created`) to stdout.

### Local auth

Testkit uses an isolated session directory as **`HOME`** by default, so `execCmd` may not see your normal `~/.sf` auth. **Locally**, use:

```bash
export TESTKIT_HOMEDIR="$HOME"
export TESTKIT_ORG_USERNAME='your-alias'
yarn mocha "test/nuts/service-process/service-process-org.nut.ts" --timeout 600000
```
