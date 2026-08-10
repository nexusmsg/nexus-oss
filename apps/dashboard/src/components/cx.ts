/** Tiny class-merge helper — no dependencies. */
export function cx(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}
