import type { RelatedBase } from "../../data/dbcalc";
import type { Group } from "../../data/dbgroup";
import type { DbConfig, DbView, Option, Prop, PropType, Row, Value } from "../../data/dbquery";
import type { Key } from "../../i18n";

/** Types de propriété proposés à la création, avec leur libellé. */
export const PROP_TYPES: [PropType, Key][] = [
  ["text", "propText"],
  ["number", "propNumber"],
  ["select", "propSelect"],
  ["multi_select", "propMulti"],
  ["date", "propDate"],
  ["checkbox", "propCheckbox"],
  ["url", "propUrl"],
  ["email", "propEmail"],
  ["phone", "propPhone"],
  ["files", "propFiles"],
  ["formula", "propFormula"],
  ["relation", "propRelation"],
  ["rollup", "propRollup"],
  ["created_time", "propCreated"],
  ["last_edited_time", "propEdited"],
];

export const typeLabel = (type: PropType): Key => PROP_TYPES.find(([t]) => t === type)?.[1] ?? "propText";

/** Noms des couleurs d'étiquette, dans l'ordre de OPTION_COLORS. */
export const COLOR_NAMES: Record<string, Key> = {
  gray: "colorGray",
  brown: "colorBrown",
  orange: "colorOrange",
  yellow: "colorYellow",
  green: "colorGreen",
  blue: "colorBlue",
  purple: "colorPurple",
  pink: "colorPink",
  red: "colorRed",
};

export const FIELD = "h-7 rounded bg-hover px-1.5";
export const LINE = "shadow-[inset_0_-1px_0_var(--color-line)]";
/** Bouton qui n'apparaît qu'au survol ou au focus de sa ligne (toujours visible au toucher). */
export const REVEAL =
  "opacity-0 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 max-sm:opacity-100";

export const uid = () => crypto.randomUUID().slice(0, 8);

/** Tout ce dont les vues ont besoin pour lire et modifier la base. */
export type Api = {
  databaseId: string;
  /** Toutes les propriétés de la base. */
  props: Prop[];
  /** Propriétés affichées par la vue, dans son ordre. */
  shown: Prop[];
  /** Lignes affichées : filtrées, recherchées et triées, avec les valeurs calculées. */
  rows: Row[];
  /** Regroupement de la vue (null sans groupe) et propriété qui le définit. */
  groups: Group[] | null;
  groupProp: Prop | undefined;
  view: DbView;
  related: Map<string, RelatedBase>;
  ctx: { weekStart: 0 | 1 };
  lang: string;
  /** Vrai quand l'ordre manuel des lignes peut être changé (aucun tri ni regroupement). */
  canReorder: boolean;
  /** Ligne tout juste créée, dont le nom doit recevoir le curseur. */
  fresh: string | null;
  clearFresh: () => void;
  /** Ouvre l'aperçu latéral d'une ligne. */
  peek: (id: string) => void;
  openPage: (id: string) => void;
  add: (props?: Record<string, Value>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  /** Place la ligne avant une autre (à la fin si null) dans l'ordre manuel. */
  moveRow: (id: string, beforeId: string | null) => Promise<void>;
  setTitle: (id: string, title: string) => Promise<void>;
  setValue: (row: Row, propId: string, value: Value) => Promise<void>;
  setValues: (row: Row, patch: Record<string, Value>) => Promise<void>;
  setOptions: (propId: string, options: Option[]) => void;
  updateProp: (propId: string, patch: Partial<Prop>) => void;
  /** Change le type d'une propriété en convertissant ses valeurs (annulable). */
  convertProp: (propId: string, to: PropType) => Promise<void>;
  duplicateProp: (propId: string) => Promise<void>;
  /** Supprime la propriété (annulable) et ses réglages dans les vues. */
  deleteProp: (propId: string) => void;
  /** Active ou coupe la relation miroir d'une relation. */
  setTwin: (propId: string, on: boolean) => Promise<void>;
  setConfig: (update: (config: DbConfig) => DbConfig) => void;
  patchView: (patch: Partial<DbView>) => void;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  /** Une ligne de la base, même masquée par les filtres de la vue. */
  rowById: (id: string) => Row | undefined;
  /** Titre d'une page (ligne liée) ; null si elle n'existe plus. */
  titleOf: (id: string) => string | null;
  /** Ouvre le menu des filtres de la barre d'outils. */
  openFilters: () => void;
};
