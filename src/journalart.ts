/**
 * The journal's portraits (src/journal-art.json, written by tools/gen.py), loaded on first need instead of
 * riding in the main bundle: at ~90 KB gzipped they'd otherwise be downloaded by every player before the tank
 * could show. main.ts prefetches them just after the tank's first frame, so the journal still opens with them.
 */

let art: Record<string, string> = {};
let loading: Promise<Record<string, string>> | null = null;

/** The portraits loaded so far, by key ({} until loadJournalArt has resolved). */
export const journalArt = (): Record<string, string> => art;

/** Load the portraits once (later calls share the same load). A failed load is retried on the next call. */
export function loadJournalArt(): Promise<Record<string, string>> {
  // a glob rather than a plain import: the file is generated, and a checkout without it still builds
  const mods = import.meta.glob("./journal-art.json", { import: "default" }) as Record<string, () => Promise<Record<string, string>>>;
  const load = Object.values(mods)[0];
  if (!load) return Promise.resolve(art);
  loading ??= load().then(
    (a) => (art = a),
    () => {
      loading = null;
      return art;
    },
  );
  return loading;
}
