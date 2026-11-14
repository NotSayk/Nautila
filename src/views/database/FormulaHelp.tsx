import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { formulaIssue, FORMULA_FUNCTION_NAMES, type FormulaIssue, type Prop } from "../../data/dbquery";
import { useT, type Key } from "../../i18n";

/** Forme d'appel de chaque fonction, telle qu'on l'écrit dans une formule. */
const SIGNATURES: Record<string, string> = {
  if: "if(cond; a; b)",
  and: "and(a; b; …)",
  or: "or(a; b; …)",
  not: "not(a)",
  empty: "empty(x)",
  round: "round(x; n)",
  floor: "floor(x)",
  ceil: "ceil(x)",
  abs: "abs(x)",
  sqrt: "sqrt(x)",
  pow: "pow(x; y)",
  mod: "mod(x; y)",
  min: "min(a; b; …)",
  max: "max(a; b; …)",
  sum: "sum(a; b; …)",
  number: "number(texte)",
  text: "text(x)",
  concat: "concat(a; b; …)",
  length: "length(texte)",
  upper: "upper(texte)",
  lower: "lower(texte)",
  trim: "trim(texte)",
  contains: "contains(texte; extrait)",
  replace: "replace(texte; ancien; nouveau)",
  slice: "slice(texte; début; fin)",
  today: "today()",
  now: "now()",
  days: "days(début; fin)",
  dateAdd: "dateAdd(date; n; unité)",
  formatDate: "formatDate(date; modèle)",
  year: "year(date)",
  month: "month(date)",
  day: "day(date)",
  weekday: "weekday(date)",
};

/** Message d'une formule invalide, dans la langue courante. */
export function formulaMessage(issue: FormulaIssue, t: (key: Key) => string): string {
  const key: Record<FormulaIssue["code"], Key> = {
    syntax: "fErrSyntax",
    unclosed: "fErrUnclosed",
    unknownFunction: "fErrUnknownFunction",
    unknownProp: "fErrUnknownProp",
    argCount: "fErrArgCount",
    type: "fErrType",
    divZero: "fErrDivZero",
  };
  // Pour un nombre d'arguments incorrect, le détail est « nom min-max » : on affiche la forme attendue.
  const detail = issue.code === "argCount" ? (SIGNATURES[issue.detail.split(" ")[0]] ?? issue.detail) : issue.detail;
  return t(key[issue.code]).replace("{d}", detail);
}

/** Liste des fonctions disponibles, avec leur forme et leur rôle. */
export function FormulaHelp() {
  const t = useT();
  return (
    <div className="space-y-2 rounded-md bg-panel p-2 text-[13px]">
      <p>{t("formulaHelpIntro")}</p>
      <p className="font-medium">{t("formulaFunctions")}</p>
      <dl className="max-h-56 space-y-1.5 overflow-y-auto">
        {FORMULA_FUNCTION_NAMES.map((name) => (
          <div key={name}>
            <dt className="font-mono text-[12px]">{SIGNATURES[name] ?? name}</dt>
            <dd className="text-muted">{t(`fn_${name}` as Key)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Saisie d'une formule, avec son diagnostic et l'aide intégrée. */
export function FormulaField({ prop, props, onChange }: { prop: Prop; props: Prop[]; onChange: (formula: string) => void }) {
  const t = useT();
  const [help, setHelp] = useState(false);
  const [text, setText] = useState(prop.formula ?? "");
  // Les formules qui se citent elles-mêmes ne peuvent pas être évaluées : on ne propose que les autres propriétés.
  const issue = text.trim() ? formulaIssue(text, props.filter((p) => p.id !== prop.id)) : null;
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <input
          aria-label={t("propFormula")}
          value={text}
          placeholder={t("formulaHint")}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (prop.formula ?? "") && onChange(text)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-invalid={!!issue}
          className="h-7 min-w-0 flex-1 rounded bg-hover px-2 font-mono text-[13px] placeholder:text-faint"
        />
        <button
          type="button"
          aria-label={t("formulaHelp")}
          title={t("formulaHelp")}
          aria-pressed={help}
          onClick={() => setHelp(!help)}
          className={`grid size-7 shrink-0 place-items-center rounded hover:bg-hover ${help ? "text-accent-text" : "text-muted"}`}
        >
          <CircleHelp size={15} />
        </button>
      </div>
      {issue ? (
        <p role="alert" className="px-1 text-xs text-danger">
          {formulaMessage(issue, t)}
        </p>
      ) : (
        text.trim() && <p className="px-1 text-xs text-faint">{t("formulaValid")}</p>
      )}
      {help && <FormulaHelp />}
    </div>
  );
}
