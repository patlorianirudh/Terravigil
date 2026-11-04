// Services barrel export. `dto`/`mappers`/`http` are deliberately NOT re-exported:
// they are the backend-contract seam (PRD P-20.24) and only `api`/`socket` use them.
export * from './api';
export * from './socket';
export * from './errors';
