/** "1 fact", "2 facts": counts in UI copy never read "1 facts". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

