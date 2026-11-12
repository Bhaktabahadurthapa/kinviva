import { api } from "./api";

/** Where a stored value comes from: the app's database when it has one, otherwise a copy kept in the window's browser storage by an earlier version. */
export function pickStored(db: string | null, local: string | null): { value: string | null; importToDb: boolean } {
  if (db !== null) return { value: db, importToDb: false };
  return { value: local, importToDb: local !== null };
}

const KEYS: [name: string, local: string][] = [
  ["resume", "ml.jobs.resume1"], ["apps", "ml.jobs.apps1"], ["prefs", "ml.jobs.prefs1"], ["seen", "ml.jobs.seen1"], ["last", "ml.jobs.last1"],
];

function local(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Loads the job workspace from the database. Anything an earlier version kept only in browser storage is copied into the database once; the browser copy is left in place. */
export async function loadWorkspace(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const [name, lk] of KEYS) {
    let db: string | null = null;
    try {
      db = await api.jobsKvGet(name);
    } catch {
      db = null;
    }
    const p = pickStored(db, local(lk));
    out[name] = p.value;
    if (p.importToDb && p.value !== null) await api.jobsKvSet(name, p.value).catch(() => undefined);
  }
  return out;
}
