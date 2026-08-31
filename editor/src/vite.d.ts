declare module '*?worker' {
  interface WorkerLike {
    postMessage(message: unknown): void;
    terminate(): void;
  }

  const WorkerConstructor: new () => WorkerLike;
  export default WorkerConstructor;
}