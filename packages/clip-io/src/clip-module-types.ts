/** Minimal surface of the Emscripten-generated module that clip-writer.ts relies on. */
export interface ClipModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cwrap<T extends (...args: any[]) => any>(name: string, returnType: string | null, argTypes: string[]): T;
}

export type CreateClipModule = () => Promise<ClipModule>;
