/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as path from 'node:path';

/**
 * Env helpers for org NUTs (`service-process-org.nut.ts` runs when `TESTKIT_ORG_USERNAME` is set).
 * For local runs, set `TESTKIT_HOMEDIR=$HOME` so testkit’s child CLI sees your `~/.sf` auth (see `test/nuts/README.md`).
 */

/** Opt-in for deploy → list → retrieve chain (also requires deploy zip path). */
export function isServiceProcessE2ENutsEnabled(): boolean {
  const v = process.env.SERVICE_PROCESS_NUT_E2E?.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function getTestkitOrgUsername(): string | undefined {
  const u = process.env.TESTKIT_ORG_USERNAME?.trim();
  if (!u) return undefined;
  return u;
}

export function getTestkitServiceProcessId(): string | undefined {
  const id = process.env.TESTKIT_SERVICE_PROCESS_ID?.trim();
  if (!id) return undefined;
  return id;
}

/** Absolute path to deploy input zip; from TESTKIT_DEPLOY_INPUT_ZIP (relative paths resolved from cwd). */
export function getDeployInputZipPath(): string | undefined {
  const raw = process.env.TESTKIT_DEPLOY_INPUT_ZIP?.trim();
  if (!raw) return undefined;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}
