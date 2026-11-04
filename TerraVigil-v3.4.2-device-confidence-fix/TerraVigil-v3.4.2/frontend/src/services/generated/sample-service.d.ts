declare const service: {
  metadata(): unknown;
  answer(question: string): { mission_id: string; synthetic: boolean; answer: string };
  dispatchSample(method: string, url: string, body?: unknown, options?: { exclusive: boolean }): { status: number; body: unknown } | null;
};
export default service;
