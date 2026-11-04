/**
 * Service boundary error type. Errors cross the service boundary as typed
 * results or as this error class — never as thrown strings.
 */

export type ServiceErrorKind = 'offline' | 'unavailable' | 'invalid' | 'not_implemented';

export class ServiceError extends Error {
  readonly kind: ServiceErrorKind;
  /** Safe backend error code, when the server supplied one. */
  readonly code: string | undefined;

  constructor(kind: ServiceErrorKind, message: string, code?: string) {
    super(message);
    this.name = 'ServiceError';
    this.kind = kind;
    this.code = code;
  }
}

/** Thrown by live adapters in Phase 1 — the seam is real and provable. */
export class NotImplementedError extends ServiceError {
  constructor(feature: string) {
    super('not_implemented', `[live] ${feature} is not implemented in this phase.`);
    this.name = 'NotImplementedError';
  }
}

/** Subscription-based streaming reads return an unsubscribe function. */
export type Unsubscribe = () => void;

export type StreamListener<T> = (value: T) => void;
