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

type StageData = {
  duration?: string;
  error?: string;
};

/**
 * Wrapper for MultiStageOutput to display rollback progress.
 * Creates a separate MSO instance for rollback, shown only when deployment fails.
 */
export class RollbackStages {
  private mso: MultiStageOutput<StageData>;
  private command: SfCommand<unknown>;
  private rollbackItems?: Array<{ label: string; value: string }>;

  public constructor(command: SfCommand<unknown>) {
    this.command = command;

    this.mso = new MultiStageOutput<StageData>({
      title: 'Service Process Rollback',
      stages: ['Rolling back changes'],
      jsonEnabled: command.jsonEnabled(),
      stageSpecificBlock: [
        {
          stage: 'Rolling back changes',
          type: 'message',
          get: (): string | undefined => {
            if (!this.rollbackItems || this.rollbackItems.length === 0) return undefined;
            const lines = this.rollbackItems.map((item) =>
              item.label ? `  ${item.label}: ${item.value}` : `  ${item.value}`
            );
            return lines.join('\n');
          },
        },
      ],
    });
  }

  public start(): void {
    if (!this.command.jsonEnabled()) {
      this.mso.goto('Rolling back changes');
    }
  }

  public updateProgress(items: Array<{ label: string; value: string }>): void {
    if (!this.command.jsonEnabled()) {
      this.rollbackItems = items;
      this.mso.updateData({});
    }
  }

  public succeed(duration: number): void {
    if (!this.command.jsonEnabled()) {
      const durationStr = (duration / 1000).toFixed(2);
      this.mso.updateData({ duration: `${durationStr}s` });
      this.mso.stop();
    }
  }

  public fail(error: Error): void {
    if (!this.command.jsonEnabled()) {
      this.mso.updateData({ error: error.message });
      this.mso.error();
    }
  }
}
