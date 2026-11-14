import { useEffect, useId, useRef } from "react";
import { create } from "zustand";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useOverlay } from "./common";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre modale accessible : role="dialog", aria-modal, focus piégé (Tab boucle dans la fenêtre),
 * Échap ferme, un clic sur le fond ferme, et le focus revient à l'élément d'origine.
 * Si un enfant a `autoFocus`, il garde le focus ; sinon le premier élément focalisable le reçoit.
 */
export function Modal({
  label,
  labelledBy,
  describedBy,
  onClose,
  className = "",
  position = "top",
  children,
}: {
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  onClose: () => void;
  className?: string;
  position?: "top" | "center";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(onClose);
  useEffect(() => {
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) (box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
  }, []);
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/40 p-4 ${
        position === "top" ? "items-start pt-[14vh]" : "items-center"
      }`}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`max-w-full rounded-xl bg-pop shadow-pop ${className}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (el) => el.offsetParent !== null || el === document.activeElement,
          );
          if (items.length === 0) return e.preventDefault();
          const first = items[0];
          const last = items[items.length - 1];
          const at = document.activeElement;
          if (e.shiftKey && (at === first || at === e.currentTarget)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && at === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructive : le bouton de confirmation est rouge. */
  danger?: boolean;
};

const useConfirmState = create<{ req: { opts: ConfirmOptions; resolve: (ok: boolean) => void } | null }>(() => ({
  req: null,
}));

/** Dialogue de confirmation impératif, à la place de `confirm()` : résout `true` si confirmé. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Une demande encore ouverte est annulée plutôt que perdue.
    useConfirmState.getState().req?.resolve(false);
    useConfirmState.setState({ req: { opts, resolve } });
  });
}

/** Message bref en bas de l'écran, à la place de `alert()`. `action` ajoute un bouton (ex. « Annuler »). */
export function notify(message: string, options: { action?: { label: string; run: () => void } } = {}) {
  useStore.setState({ toast: { message, action: options.action } });
}

/** À monter une fois (App.tsx) : affiche le dialogue demandé par `confirmDialog`. */
export function ConfirmHost() {
  const req = useConfirmState((s) => s.req);
  return req ? <ConfirmDialog key={req.opts.message} {...req} /> : null;
}

function ConfirmDialog({ opts, resolve }: { opts: ConfirmOptions; resolve: (ok: boolean) => void }) {
  const t = useT();
  const id = useId();
  const answer = (ok: boolean) => {
    useConfirmState.setState({ req: null });
    resolve(ok);
  };
  return (
    <Modal
      position="center"
      labelledBy={opts.title ? `${id}-t` : undefined}
      label={opts.title ? undefined : opts.message}
      describedBy={`${id}-m`}
      onClose={() => answer(false)}
      className="w-full max-w-sm p-5"
    >
      {opts.title && (
        <p id={`${id}-t`} className="text-base font-semibold">
          {opts.title}
        </p>
      )}
      <p id={`${id}-m`} className={opts.title ? "mt-2 text-muted" : ""}>
        {opts.message}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="h-8 rounded-md px-3 hover:bg-hover" onClick={() => answer(false)}>
          {opts.cancelLabel ?? t("cancel")}
        </button>
        <button
          autoFocus
          className={`h-8 rounded-md px-3 font-medium text-white hover:brightness-95 ${opts.danger ? "bg-danger" : "bg-accent"}`}
          onClick={() => answer(true)}
        >
          {opts.confirmLabel ?? t("confirm")}
        </button>
      </div>
    </Modal>
  );
}
