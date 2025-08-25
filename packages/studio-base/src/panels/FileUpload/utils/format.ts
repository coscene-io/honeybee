export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function bytes(x: number) {
  if (x < 1024) return `${x} B`;
  if (x < 1024 ** 2) return `${(x / 1024).toFixed(1)} KB`;
  if (x < 1024 ** 3) return `${(x / 1024 ** 2).toFixed(1)} MB`;
  return `${(x / 1024 ** 3).toFixed(2)} GB`;
}

export const iso = (s: string) => new Date(s).toLocaleString();