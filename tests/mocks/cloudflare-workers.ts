export class DurableObject {
  ctx: any;
  env: any;
  constructor(ctx: any, env: any) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint {
  ctx: any;
  env: any;
  constructor(ctx: any, env: any) {
    this.ctx = ctx;
    this.env = env;
  }
}
