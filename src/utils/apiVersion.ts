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

/** Minimum API version required for service-process deploy and retrieve (e.g. 66.0). */
export const MIN_SERVICE_PROCESS_API_VERSION = '66.0';

/** API version at which template deploy POST accepts optional body with serviceProcessName (from templateData.json name). */
export const MIN_API_VERSION_TEMPLATE_DEPLOY_SERVICE_PROCESS_NAME = '67.0';

/**
 * Returns true if version is >= min when compared as major.minor.
 * Invalid formats are treated as not meeting the minimum.
 */
export function isApiVersionAtLeast(version: string, min: string): boolean {
  const v = parseVersion(version);
  const m = parseVersion(min);
  if (v == null || m == null) return false;
  if (v.major !== m.major) return v.major > m.major;
  return v.minor >= m.minor;
}

function parseVersion(s: string): { major: number; minor: number } | null {
  const trimmed = typeof s === 'string' ? s.trim() : '';
  if (trimmed.length === 0) return null;
  const parts = trimmed.split('.');
  if (parts.length < 2) return null;
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  if (Number.isNaN(major) || Number.isNaN(minor)) return null;
  return { major, minor };
}

/** Message when API version is below minimum. When fromFlag is true, message references --api-version; otherwise target org. */
export function getUnsupportedApiVersionMessage(actualVersion: string, fromFlag?: boolean): string {
  if (fromFlag) {
    return `Unsupported API version: minimum supported version is v${MIN_SERVICE_PROCESS_API_VERSION}, but --api-version is set to v${actualVersion}.`;
  }
  return `Unsupported API version: this command requires API v${MIN_SERVICE_PROCESS_API_VERSION} or higher. Target org is on v${actualVersion}.`;
}
