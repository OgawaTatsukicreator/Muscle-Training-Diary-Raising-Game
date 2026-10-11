import {
  GUEST_STORAGE_KEY,
  initialGuestState,
  parseGuestState,
  type DemoDataState,
  type GuestMutation,
} from "@/lib/storage/guest-state";

type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type GuestLockRunner = <T>(name: string, operation: () => T) => Promise<T>;
type FailureKind = "read" | "invalid" | "write" | "unsupported";

export class GuestStorageError extends Error {
  constructor(public readonly kind: FailureKind) {
    super(kind);
    this.name = "GuestStorageError";
  }
}

export function guestStorageMessage(error: unknown): string {
  if (error instanceof GuestStorageError) {
    if (error.kind === "invalid") {
      return "端末に保存されたデータを確認できません。元データは消していません。必要なら設定からゲストのデータを消去してください。";
    }
    if (error.kind === "read") {
      return "端末の保存領域を読み込めません。ブラウザの保存設定を確認してください。";
    }
    if (error.kind === "unsupported") {
      return "このブラウザではゲストのデータを安全に保存できません。ブラウザを更新するか、アカウントでログインしてください。";
    }
  }
  return "端末へ保存できませんでした。変更は反映していません。保存容量やブラウザの保存設定を確認し、もう一度お試しください。";
}

/** The reducer and write are synchronous inside one origin-wide exclusive lock. */
export class TransactionalGuestStore {
  private raw: string | null | undefined;
  private cached: DemoDataState = initialGuestState();

  constructor(
    private readonly storage: () => StorageAccess,
    private readonly runExclusive: GuestLockRunner | null,
  ) {}

  read(): DemoDataState {
    let raw: string | null;
    try {
      raw = this.storage().getItem(GUEST_STORAGE_KEY);
    } catch {
      throw new GuestStorageError("read");
    }
    if (this.raw === raw) return this.cached;

    let state: DemoDataState;
    try {
      state = raw === null ? initialGuestState() : parseGuestState(raw);
    } catch {
      // Never replace an unrecognized or corrupt value with an empty state.
      throw new GuestStorageError("invalid");
    }
    this.raw = raw;
    this.cached = state;
    return state;
  }

  async change<T>(reduce: (latest: DemoDataState) => GuestMutation<T>): Promise<GuestMutation<T>> {
    if (!this.runExclusive) throw new GuestStorageError("unsupported");
    return this.runExclusive(GUEST_STORAGE_KEY, () => {
      // Do not use a tab's React snapshot: another tab may have committed meanwhile.
      const latest = this.read();
      const mutation = reduce(latest);
      if (!mutation.result.ok || mutation.state === latest) return mutation;

      let raw: string;
      try {
        raw = JSON.stringify(mutation.state);
        this.storage().setItem(GUEST_STORAGE_KEY, raw);
      } catch {
        // A failed persistence must not produce a success result or optimistic state.
        throw new GuestStorageError("write");
      }
      this.raw = raw;
      this.cached = mutation.state;
      return mutation;
    });
  }

  async clear(): Promise<DemoDataState> {
    if (!this.runExclusive) throw new GuestStorageError("unsupported");
    return this.runExclusive(GUEST_STORAGE_KEY, () => {
      try {
        this.storage().removeItem(GUEST_STORAGE_KEY);
      } catch {
        throw new GuestStorageError("write");
      }
      this.raw = null;
      this.cached = initialGuestState();
      return this.cached;
    });
  }
}

export function createBrowserGuestStore(): TransactionalGuestStore {
  const runExclusive: GuestLockRunner | null =
    typeof navigator.locks?.request === "function"
      ? (name, operation) => navigator.locks.request(name, { mode: "exclusive" }, operation)
      : null;
  return new TransactionalGuestStore(() => window.localStorage, runExclusive);
}
