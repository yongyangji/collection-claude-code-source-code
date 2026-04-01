/**
 * 遥测系统 stub（已移除）
 */

export function logEvent(..._args: any[]): void {
  // no-op: telemetry removed
}

export function isAnalyticsDisabled(): boolean {
  return true;
}

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never;

export function sanitizeToolNameForAnalytics(toolName: string): any {
  return toolName;
}