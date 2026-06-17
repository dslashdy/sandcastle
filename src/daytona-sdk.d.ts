/** Minimal type declarations for @daytona/sdk (optional peer dependency). */
declare module "@daytona/sdk" {
  export interface DaytonaConfig {
    apiKey?: string;
    apiUrl?: string;
    target?: string;
  }

  export interface CreateSandboxFromImageParams {
    [key: string]: unknown;
  }

  export interface CreateSandboxFromSnapshotParams {
    [key: string]: unknown;
  }

  export class Daytona {
    constructor(config?: DaytonaConfig);
    create(
      params?: CreateSandboxFromImageParams | CreateSandboxFromSnapshotParams,
    ): Promise<any>;
    delete(sandbox: any): Promise<void>;
  }
}
