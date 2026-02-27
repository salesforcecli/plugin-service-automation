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

export type RetrieveStage =
  | 'Validating Request'
  | 'Fetching Service Process'
  | 'Resolving related components'
  | 'Retrieving metadata'
  | 'Generating consolidated package'
  | 'Creating ZIP archive'
  | 'Done';

type StageData = {
  duration?: string;
  /** Fetching Service Process: name, recordId, productCode */
  serviceProcessName?: string;
  serviceProcessRecordId?: string;
  serviceProcessProductCode?: string;
  /** Resolving related components: counts */
  preprocessorsCount?: number;
  intakeFlowCount?: number;
  fulfillmentFlowCount?: number;
  /** Retrieving metadata: items as label: value lines */
  retrievingMetadataMessage?: string;
  error?: string;
};

/**
 * Wrapper for MultiStageOutput to display retrieve phases with spinners and status indicators.
 * Matches the deploy command UX pattern using @oclif/multi-stage-output.
 */
export class RetrieveStages {
  private mso: MultiStageOutput<StageData>;
  private command: SfCommand<unknown>;
  private phaseStartTimes: Map<string, number>;

  public constructor(command: SfCommand<unknown>, title: string, orgUrl: string) {
    this.command = command;
    this.phaseStartTimes = new Map();

    this.mso = new MultiStageOutput<StageData>({
      title,
      stages: [
        'Validating Request',
        'Fetching Service Process',
        'Resolving related components',
        'Retrieving metadata',
        'Generating consolidated package',
        'Creating ZIP archive',
        'Done',
      ],
      jsonEnabled: command.jsonEnabled(),
      showElapsedTime: true,
      showStageTime: true,
      timerUnit: 's',
      preStagesBlock: [
        {
          type: 'message',
          get: (): string => `Org Connected: ${orgUrl}`,
        },
      ],
      stageSpecificBlock: [
        {
          stage: 'Fetching Service Process',
          type: 'message',
          get: (data?: StageData): string | undefined => {
            if (
              !data?.serviceProcessName &&
              data?.serviceProcessRecordId === undefined &&
              data?.serviceProcessProductCode === undefined
            ) {
              return undefined;
            }
            const lines: string[] = [];
            if (data.serviceProcessName != null) {
              lines.push(`  ▸ Name        : ${data.serviceProcessName}`);
            }
            if (data.serviceProcessRecordId != null) {
              lines.push(`  ▸ Record ID   : ${data.serviceProcessRecordId}`);
            }
            if (data.serviceProcessProductCode != null) {
              lines.push(`  ▸ Product Code: ${data.serviceProcessProductCode}`);
            }
            return lines.length > 0 ? lines.join('\n') : undefined;
          },
        },
        {
          stage: 'Resolving related components',
          type: 'message',
          get: (data?: StageData): string | undefined => {
            const pre = data?.preprocessorsCount ?? 0;
            const intake = data?.intakeFlowCount ?? 0;
            const fulfill = data?.fulfillmentFlowCount ?? 0;
            if (pre === 0 && intake === 0 && fulfill === 0) return undefined;
            const lines: string[] = [];
            lines.push(`  ▸ Preprocessors   : ${pre} found`);
            lines.push(`  ▸ Intake Flow     : ${intake} found`);
            lines.push(`  ▸ Fulfillment Flow: ${fulfill} found`);
            return lines.join('\n');
          },
        },
        {
          stage: 'Retrieving metadata',
          type: 'message',
          get: (data?: StageData): string | undefined => {
            if (!data?.retrievingMetadataMessage) return undefined;
            return data.retrievingMetadataMessage;
          },
        },
      ],
    });
  }

  public shouldLog(): boolean {
    return !this.command.jsonEnabled();
  }

  public start(): void {
    if (!this.shouldLog()) return;
    this.mso.goto('Validating Request');
  }

  public startPhase(phase: RetrieveStage): void {
    if (!this.shouldLog()) return;
    this.phaseStartTimes.set(phase, Date.now());
    this.mso.goto(phase);
  }

  public succeedPhase(phase: RetrieveStage): void {
    if (!this.shouldLog()) return;

    const phaseStart = this.phaseStartTimes.get(phase);
    const duration = phaseStart ? Date.now() - phaseStart : 0;
    const durationStr = duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`;
    this.phaseStartTimes.delete(phase);
    this.mso.updateData({ duration: durationStr });
  }

  public setServiceProcessDetails(name: string, recordId: string, productCode?: string): void {
    if (!this.shouldLog()) return;
    this.mso.updateData({
      serviceProcessName: name,
      serviceProcessRecordId: recordId,
      serviceProcessProductCode: productCode ?? undefined,
    });
  }

  public setResolvingCounts(preprocessors: number, intakeFlow: number, fulfillmentFlow: number): void {
    if (!this.shouldLog()) return;
    this.mso.updateData({
      preprocessorsCount: preprocessors,
      intakeFlowCount: intakeFlow,
      fulfillmentFlowCount: fulfillmentFlow,
    });
  }

  public setRetrievingMetadataLines(lines: Array<{ label: string; value: string }>): void {
    if (!this.shouldLog()) return;
    const text = lines.map((l) => `  ▸ ${l.label.padEnd(17)}: ${l.value}`).join('\n');
    this.mso.updateData({ retrievingMetadataMessage: text });
  }

  public failPhase(phase: RetrieveStage, error: Error): void {
    if (!this.shouldLog()) return;

    const phaseStart = this.phaseStartTimes.get(phase);
    const duration = phaseStart ? Date.now() - phaseStart : 0;
    const durationStr = duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`;
    this.phaseStartTimes.delete(phase);
    this.mso.updateData({ duration: durationStr, error: error.message });
    this.mso.error();
  }

  public stop(): void {
    if (!this.shouldLog()) return;
    this.mso.stop();
  }
}
