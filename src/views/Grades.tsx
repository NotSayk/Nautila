import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addGrade,
  average,
  deleteGrade,
  listCoefficients,
  listGrades,
  overall,
  setCoefficient,
  type Grade,
} from "../data/school";
import type { PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { IconButton, PageIcon, View } from "./common";

const FIELD = "h-8 min-w-0 rounded-md bg-transparent px-2 hover:bg-hover focus:bg-hover placeholder:text-faint";
const num = (s: string) => Number(s.trim().replace(",", "."));

function format(value: number | null, lang: string) {
  return value === null
    ? "–"
    : new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function CourseGrades({
  course,
  grades,
  coef,
  reload,
}: {
  course: PageMeta;
  grades: Grade[];
  coef: number;
  reload: () => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const navigate = useStore((s) => s.navigate);
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("");
  const [outOf, setOutOf] = useState("20");
  const [weight, setWeight] = useState("1");
  const valid = score.trim() !== "" && num(score) >= 0 && num(outOf) > 0 && num(weight) > 0;
  const cols = "grid grid-cols-[minmax(0,1fr)_64px_64px_64px_28px] items-center gap-1";

  return (
    <section className="mb-8">
      <div className="mb-1 flex items-center gap-2">
        <button
          onClick={() => navigate({ view: "page", id: course.id })}
          className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-base font-semibold hover:bg-hover"
        >
          <PageIcon page={course} />
          <span className="truncate">{course.title || t("untitled")}</span>
        </button>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-muted">
          {t("coefficient")}
          <input
            key={coef}
            defaultValue={coef}
            inputMode="decimal"
            aria-label={`${t("coefficient")} ${course.title}`}
            onBlur={async (e) => {
              const value = num(e.target.value);
              if (value > 0 && value !== coef) {
                await setCoefficient(course.id, value);
                reload();
              } else e.target.value = String(coef);
            }}
            className={`${FIELD} h-7 w-12 text-center text-sm text-ink`}
          />
        </label>
        <span className="w-16 text-right text-base font-semibold tabular-nums">{format(average(grades), lang)}</span>
      </div>
      <div className={`${cols} h-7 px-1 text-xs text-faint shadow-[inset_0_-1px_0_var(--color-line)]`}>
        <span className="px-2">{t("gradeTitle")}</span>
        <span className="px-2">{t("gradeScore")}</span>
        <span className="px-2">{t("outOf")}</span>
        <span className="px-2">{t("weight")}</span>
        <span />
      </div>
      {grades.map((g) => (
        <div key={g.id} className={`${cols} group min-h-9 px-1 shadow-[inset_0_-1px_0_var(--color-line)]`}>
          <span className="truncate px-2 font-medium">{g.title}</span>
          <span className="px-2 tabular-nums">{g.score}</span>
          <span className="px-2 tabular-nums text-muted">{g.out_of}</span>
          <span className="px-2 tabular-nums text-muted">{g.weight}</span>
          <IconButton
            label={t("delete")}
            onClick={async () => {
              await deleteGrade(g.id);
              reload();
            }}
            className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <form
        className={`${cols} mt-1 px-1`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          await addGrade({
            course_id: course.id,
            title: title.trim() || t("gradeTitle"),
            score: num(score),
            out_of: num(outOf),
            weight: num(weight),
          });
          setTitle("");
          setScore("");
          reload();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`+ ${t("gradeTitle")}`}
          aria-label={t("gradeTitle")}
          className={FIELD}
        />
        <input
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder="14"
          inputMode="decimal"
          aria-label={t("gradeScore")}
          className={FIELD}
        />
        <input
          value={outOf}
          onChange={(e) => setOutOf(e.target.value)}
          inputMode="decimal"
          aria-label={t("outOf")}
          className={`${FIELD} text-muted`}
        />
        <input
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          inputMode="decimal"
          aria-label={t("weight")}
          className={`${FIELD} text-muted`}
        />
        <button
          disabled={!valid}
          aria-label={t("add")}
          className="grid size-7 place-items-center rounded-md bg-accent text-white disabled:bg-active disabled:text-faint"
        >
          +
        </button>
      </form>
    </section>
  );
}

export function Grades() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [coefs, setCoefs] = useState<Record<string, number>>({});

  const reload = () => {
    void listGrades().then(setGrades);
    void listCoefficients().then(setCoefs);
  };
  useEffect(reload, []);

  // Seules les matières encore présentes comptent dans la moyenne générale.
  const live = grades.filter((g) => courses.some((c) => c.id === g.course_id));

  return (
    <View title={t("grades")}>
      {courses.length === 0 ? (
        <p className="text-muted">{t("noCourses")}</p>
      ) : (
        <>
          <div className="mb-10 flex items-baseline gap-3 rounded-xl bg-panel px-5 py-4">
            <span className="text-[32px] font-bold leading-none tabular-nums">
              {format(overall(live, coefs), lang)}
            </span>
            <span className="text-muted">/ 20 · {t("overallAverage")}</span>
          </div>
          {courses.map((c) => (
            <CourseGrades
              key={c.id}
              course={c}
              coef={coefs[c.id] ?? 1}
              grades={grades.filter((g) => g.course_id === c.id)}
              reload={reload}
            />
          ))}
        </>
      )}
    </View>
  );
}
