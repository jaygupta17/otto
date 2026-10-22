/**
 * Minimal ambient types for Bun's test runner.
 *
 * The app itself is built with Vite, and the project doesn't depend on
 * `bun-types`/`@types/bun`, so `tsc --noEmit` would reject `bun:test` imports.
 * Declare just the surface our tests use. Replace this with `@types/bun` when
 * the project takes that dependency.
 */
declare module "bun:test" {
  type Fn = () => void | Promise<void>;

  export function describe(name: string, fn: Fn): void;
  export function test(name: string, fn: Fn): void;
  export function it(name: string, fn: Fn): void;
  export function beforeEach(fn: Fn): void;
  export function afterEach(fn: Fn): void;
  export function setSystemTime(now?: number | Date): void;

  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toContain(expected: unknown): void;
    toHaveLength(length: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    not: Matchers;
  }

  export function expect(value: unknown): Matchers;
}
