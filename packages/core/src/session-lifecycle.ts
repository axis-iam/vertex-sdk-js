/** A result belongs to a session that has been replaced, signed out or stopped. */
export class SessionInvalidatedError extends Error {
  readonly code = 'SESSION_INVALIDATED'

  constructor() {
    super('The session changed before the operation completed')
    this.name = 'SessionInvalidatedError'
  }
}

/** Framework-neutral coordination; adapters own transport, token state and errors. */
export class SessionLifecycle<T> {
  private revision = 0
  private flight: Promise<T> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  get generation(): number {
    return this.revision
  }

  isCurrent(generation: number): boolean {
    return generation === this.revision
  }

  assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new SessionInvalidatedError()
  }

  invalidate(): void {
    this.revision += 1
    this.flight = null
    this.cancelTimer()
  }

  run(operation: (generation: number) => Promise<T>): Promise<T> {
    if (this.flight) return this.flight
    const generation = this.revision
    const flight = Promise.resolve().then(() => {
      this.assertCurrent(generation)
      // The adapter checks generation after each await, before applying its result.
      return operation(generation)
    })
    this.flight = flight
    // Both outcomes release this exact flight; an old completion cannot release a new one.
    void flight.then(() => this.release(flight), () => this.release(flight))
    return flight
  }

  scheduleAt(deadline: number, operation: () => void): void {
    if (!Number.isSafeInteger(deadline) || deadline < 0) {
      throw new TypeError('Session timer requires a valid deadline')
    }
    this.cancelTimer()
    const generation = this.revision
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.isCurrent(generation)) return
      if (Date.now() < deadline) {
        this.scheduleAt(deadline, operation)
        return
      }
      operation()
    }, Math.min(Math.max(deadline - Date.now(), 0), 2_147_483_647))
  }

  cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private release(flight: Promise<T>): void {
    if (this.flight === flight) this.flight = null
  }
}
