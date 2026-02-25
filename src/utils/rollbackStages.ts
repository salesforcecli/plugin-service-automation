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

import { MultiStageOutput } from '@oclif/multi-stage-output';
import type { SfCommand } from '@salesforce/sf-plugins-core';
import { RollbackScenario } from '../services/rollback.js';

/** Rollback step names from the rollback service (order matches execution). */
export const ROLLBACK_STEP_NAMES = [
  'Unlinking components',
  'Deleting deployed flows',
  'Removing Service Process',
] as const;

/** All rollback stages when flows were deployed (ServiceProcessAndFlows). */
const ROLLBACK_STAGES_WITH_FLOWS = [
  'Initializing Rollback',
  'Unlinking components',
  'Deleting deployed flows',
  'Removing Service Process',
] as const;

/** Stages when only Service Process was created (ServiceProcessOnly) - no "Deleting deployed flows". */
const ROLLBACK_STAGES_SERVICE_PROCESS_ONLY = [
  'Initializing Rollback',
  'Unlinking components',
  'Removing Service Process',
] as const;

/** Header line for the rollback section. Print this first, then create/start RollbackStages. */
export const ROLLBACK_SECTION_HEADER = '\n──────── Service Process Rollback ────────';

type StageData = {
  duration?: string;
  error?: string;
};

/**
 * Rollback UI: each step is an MSO stage with a live timer while running; on completion ✔ and move to next.
 * Caller must log ROLLBACK_SECTION_HEADER first.
 * When scenario is ServiceProcessOnly, "Deleting deployed flows" is omitted (no flows were deployed).
 */
export class RollbackStages {
  private mso: MultiStageOutput<StageData>;
  private command: SfCommand<unknown>;
  private stageStartTimes = new Map<string, number>();
  private readonly stages: readonly string[];
  private readonly lastStage: string;

  public constructor(command: SfCommand<unknown>, scenario: RollbackScenario) {
    this.command = command;
    this.stages =
      scenario === RollbackScenario.ServiceProcessOnly
        ? ROLLBACK_STAGES_SERVICE_PROCESS_ONLY
        : ROLLBACK_STAGES_WITH_FLOWS;
    this.lastStage = this.stages[this.stages.length - 1];

    this.mso = new MultiStageOutput<StageData>({
      stages: [...this.stages],
      jsonEnabled: command.jsonEnabled(),
      showElapsedTime: true,
      showStageTime: true,
    });
  }

  private static formatDuration(ms: number): string {
    if (ms <= 0) return '0ms';
    if (ms < 1000) return `${ms}ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(2)}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }

  public start(): void {
    if (this.command.jsonEnabled()) return;
    this.mso.goto(this.stages[0]);
    this.mso.next();
  }

  /** Step starting: go to this stage (like deployment startPhase/goto) so previous stage shows ✔ and this one gets spinner. */
  public gotoStage(step: string): void {
    if (this.command.jsonEnabled()) return;
    this.stageStartTimes.set(step, Date.now());
    this.mso.goto(step);
  }

  /** Step finished: set duration for current stage and advance (like deployment succeedPhase + next). */
  public succeedStage(step: string): void {
    if (this.command.jsonEnabled()) return;
    const start = this.stageStartTimes.get(step);
    const durationMs = start != null ? Date.now() - start : 0;
    this.mso.updateData({ duration: RollbackStages.formatDuration(durationMs) });
    this.stageStartTimes.delete(step);
    if (step !== this.lastStage) {
      this.mso.next();
    }
  }

  /** All steps done: stop MSO (last stage gets ✔, Elapsed Time shown). */
  public finish(totalDurationMs: number): void {
    if (this.command.jsonEnabled()) return;
    this.mso.updateData({ duration: RollbackStages.formatDuration(totalDurationMs) });
    this.mso.stop();
  }

  public fail(error: Error): void {
    if (this.command.jsonEnabled()) return;
    this.mso.updateData({ error: error.message });
    this.mso.error();
  }
}
