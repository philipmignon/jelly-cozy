import { Alignment, EventType, Fit, Layout, Rive, RuntimeLoader, type ViewModelInstance } from "@rive-app/webgl2";
import wasmUrl from "@rive-app/webgl2/rive.wasm?url";
import rivUrl from "../public/jellytank.riv?url";
import { K, applyAway, clean, createState, defaultSave, feed, step, tap, toSave, toggleLamp, view, type Save, type State } from "./sim";

const SAVE_KEY = "jellytank:v1";

function load(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Save;
      if (s.v === 1) return applyAway(s, Date.now());
    }
  } catch {
    /* private mode or corrupt save: start fresh */
  }
  return defaultSave();
}

function persist(s: State): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave(s, Date.now())));
  } catch {
    /* ignore */
  }
}

/** Writes only the values that changed since the last frame. */
function makeWriter(vmi: ViewModelInstance) {
  const last = new Map<string, number>();
  const handles = new Map<string, ReturnType<ViewModelInstance["number"]>>();
  for (const name of K.props) {
    const h = vmi.number(name);
    if (h) handles.set(name, h);
  }
  return (v: Record<string, number>) => {
    for (const [name, value] of Object.entries(v)) {
      if (last.get(name) === value) continue;
      const h = handles.get(name);
      if (!h) continue;
      h.value = value;
      last.set(name, value);
    }
  };
}

/** Canvas client coordinates -> logical tank pixels, matching Fit.Contain + center. */
function toLogical(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / K.W, r.height / K.H);
  const ox = (r.width - K.W * s) / 2;
  const oy = (r.height - K.H * s) / 2;
  return { x: (clientX - r.left - ox) / s / K.P, y: (clientY - r.top - oy) / s / K.P };
}

async function main() {
  RuntimeLoader.setWasmUrl(wasmUrl);
  const canvas = document.getElementById("tank") as HTMLCanvasElement;
  const state = createState(load());
  (window as unknown as { __tank: State }).__tank = state;

  const rive = await new Promise<Rive>((resolve, reject) => {
    const r: Rive = new Rive({
      canvas,
      src: rivUrl,
      artboard: "Tank",
      stateMachines: "Tank",
      autoplay: true,
      autoBind: true,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas();
        resolve(r);
      },
      onLoadError: () => reject(new Error("jellytank.riv failed to load")),
    });
  });
  new ResizeObserver(() => rive.resizeDrawingSurfaceToCanvas()).observe(canvas);

  const vmi = rive.viewModelInstance;
  if (!vmi) throw new Error("Tank view model not bound");
  const write = makeWriter(vmi);
  vmi.trigger("feed")?.on(() => feed(state));
  vmi.trigger("clean")?.on(() => clean(state));
  vmi.trigger("lamp")?.on(() => {
    toggleLamp(state);
    persist(state);
  });

  canvas.addEventListener("pointerdown", (e) => {
    const p = toLogical(canvas, e.clientX, e.clientY);
    if (p.y < K.cabTop) tap(state, p.x, p.y);
  });

  let last = performance.now();
  rive.on(EventType.Advance, () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(state, dt);
    write(view(state));
  });

  setInterval(() => persist(state), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persist(state);
  });
  window.addEventListener("pagehide", () => persist(state));
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.error = String(err);
});
