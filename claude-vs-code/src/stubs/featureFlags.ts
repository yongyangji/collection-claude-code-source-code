/**
 * Feature flags stub（所有内部 feature gate 在开源版中均为 false）
 */

export function feature(_flag: string): boolean {
  return false;
}

export function isFeatureEnabled(flag: string): boolean {
  return false;
}