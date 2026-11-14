/**
 * Impression (et enregistrement en PDF) d'un document HTML autonome, sans l'interface de l'application.
 * Le document est imprimé depuis un cadre caché ; à défaut, il est placé dans la page, seul visible
 * à l'impression.
 */
import { isTauri } from "../db";

let frame: HTMLIFrameElement | null = null;

/** Attend les images (décodées) et les polices d'un document, quelques secondes au plus. */
const ready = (doc: Document | ShadowRoot) =>
  Promise.race([loaded(doc), new Promise((resolve) => setTimeout(resolve, 5000))]);

async function loaded(doc: Document | ShadowRoot) {
  const images = [...doc.querySelectorAll("img")];
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  // Le document d'un cadre vient d'un autre contexte : instanceof Document y serait faux.
  const owner = doc.nodeType === Node.DOCUMENT_NODE ? (doc as Document) : doc.ownerDocument;
  await owner?.fonts?.ready;
}

async function printInFrame(html: string) {
  frame?.remove();
  const f = document.createElement("iframe");
  frame = f;
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  // Hors de la vue mais rendu : un cadre masqué (display: none) ne s'imprime pas.
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("print frame timeout")), 20_000);
    f.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    f.srcdoc = html;
    document.body.appendChild(f);
  });
  const win = f.contentWindow;
  if (!win) throw new Error("print frame unavailable");
  await ready(win.document);
  win.addEventListener("afterprint", () => setTimeout(() => f === frame && (f.remove(), (frame = null)), 1000), {
    once: true,
  });
  win.focus();
  win.print();
}

/** Repli : le document est ajouté à la page (dans une racine fantôme, pour isoler ses styles). */
async function printInPage(html: string) {
  document.querySelector(".print-export")?.remove();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const css = [...parsed.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  const host = document.createElement("div");
  host.className = "print-export";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${css}</style>${parsed.body.innerHTML}`;
  document.body.appendChild(host);
  document.documentElement.classList.add("printing-export");
  const done = () => {
    document.documentElement.classList.remove("printing-export");
    host.remove();
  };
  window.addEventListener("afterprint", done, { once: true });
  // L'impression native ne signale pas toujours sa fin : retour dans l'application = terminé.
  setTimeout(() => document.addEventListener("pointerdown", done, { once: true }), 500);
  await ready(root);
  // Sous macOS, l'application de bureau remplace window.print par l'impression native (promesse).
  await Promise.resolve(window.print() as unknown);
}

export async function printHtml(html: string) {
  // WKWebView (application de bureau sous macOS) n'imprime pas un cadre : seule la page entière s'imprime.
  const frameless = isTauri() && /Macintosh|Mac OS X|iPhone|iPad/.test(navigator.userAgent);
  if (!frameless) {
    try {
      await printInFrame(html);
      return;
    } catch {
      frame?.remove();
      frame = null;
    }
  }
  try {
    await printInPage(html);
  } catch {
    window.print();
  }
}
