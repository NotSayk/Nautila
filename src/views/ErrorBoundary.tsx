import { Component, type ErrorInfo, type ReactNode } from "react";
import { download, exportBackup } from "../data/backup";
import { translate, type Key } from "../i18n";
import { useStore } from "../store";

type State = { error: Error | null; exportFailed: boolean };

/** Dernier filet : un plantage de composant ne blanchit plus l'app et laisse sauvegarder ses notes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, exportFailed: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  private t = (key: Key) => translate(useStore.getState().lang, key);

  private exportData = async () => {
    try {
      download(`nautila-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), "application/json");
      this.setState({ exportFailed: false });
    } catch {
      this.setState({ exportFailed: true });
    }
  };

  render() {
    const { error, exportFailed } = this.state;
    if (!error) return this.props.children;
    const t = this.t;
    return (
      <div role="alert" className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
        <p className="text-muted">{t("errorHint")}</p>
        <details className="rounded-md bg-hover p-3 text-sm">
          <summary className="cursor-pointer select-none">{t("errorDetails")}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </details>
        {exportFailed && <p className="text-sm text-danger">{t("errorExportFailed")}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            className="h-9 rounded-md bg-accent px-4 font-medium text-white hover:brightness-95"
            onClick={() => location.reload()}
          >
            {t("errorReload")}
          </button>
          <button
            className="h-9 rounded-md px-4 shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
            onClick={this.exportData}
          >
            {t("exportBackup")}
          </button>
        </div>
      </div>
    );
  }
}
