export type RuntimeMode = 'worker' | 'channels';

export type WorkspacePolicy = 'current_project' | 'custom_path';

export type ApprovalPolicy =
  | 'sensitive_confirmation'
  | 'auto_low_risk'
  | 'fully_manual';

export interface InstallConfig {
  mode: RuntimeMode;
  workspacePolicy: WorkspacePolicy;
  workspaceRoot: string;
  approvalPolicy: ApprovalPolicy;
  preferredAutoStart: boolean;
  installedAt: string;
  updatedAt: string;
}
