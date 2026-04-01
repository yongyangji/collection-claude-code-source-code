/**
 * Token 计数工具
 */

export function estimateTokens(text: string): number {
  // 简单估算：平均每个 token 约 4 个字符
  // 对于英文更准确，中文可能低估
  return Math.ceil(text.length / 4);
}

export function formatTokenCount(count: number): string {
  if (count < 1000) {
    return `${count}`;
  } else if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}K`;
  } else {
    return `${(count / 1000000).toFixed(1)}M`;
  }
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedChars = maxTokens * 4;
  if (text.length <= estimatedChars) {
    return text;
  }
  return text.slice(0, estimatedChars) + '\n... [truncated]';
}