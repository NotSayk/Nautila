import { describe, expect, it } from "vitest";
import { dueSoon, readReminded } from "./reminders";

describe("mémo des rappels", () => {
  const today = "Sat Nov 14 2026";

  it("relit les identifiants du jour", () => {
    expect(readReminded(JSON.stringify({ day: today, ids: ["a", "b"] }), today)).toEqual(["a", "b"]);
  });

  it("repart de zéro un autre jour ou si le mémo est absent ou abîmé", () => {
    expect(readReminded(JSON.stringify({ day: "hier", ids: ["a"] }), today)).toEqual([]);
    expect(readReminded(null, today)).toEqual([]);
    expect(readReminded("{pas du json", today)).toEqual([]);
  });

  it("supporte toute forme inattendue sans échouer", () => {
    for (const raw of ["null", "42", '"texte"', "[]", "{}", `{"day":"${today}"}`, `{"day":"${today}","ids":"a"}`])
      expect(readReminded(raw, today)).toEqual([]);
    expect(readReminded(JSON.stringify({ day: today, ids: ["a", 3, null, { x: 1 }] }), today)).toEqual(["a"]);
  });
});

describe("échéances à signaler", () => {
  const now = new Date(2026, 10, 14, 10).getTime();
  const at = (days: number, hour = 12) => new Date(2026, 10, 14 + days, hour).getTime();
  const tasks = [
    { id: "retard", done: 0, due_at: at(-3) },
    { id: "aujourd'hui", done: 0, due_at: at(0, 18) },
    { id: "demain", done: 0, due_at: at(1) },
    { id: "après-demain", done: 0, due_at: at(2) },
    { id: "faite", done: 1, due_at: at(0) },
    { id: "sans date", done: 0, due_at: null },
  ];

  it("garde les tâches en retard, d'aujourd'hui et de demain, non faites", () => {
    expect(dueSoon(tasks, [], now).map((t) => t.id)).toEqual(["retard", "aujourd'hui", "demain"]);
  });

  it("n'en signale pas deux fois une déjà signalée aujourd'hui", () => {
    expect(dueSoon(tasks, ["retard", "demain"], now).map((t) => t.id)).toEqual(["aujourd'hui"]);
  });

  it("signale en cours de route une échéance qui entre dans la fenêtre", () => {
    const later = new Date(2026, 10, 15, 0, 5).getTime(); // passé minuit : après-demain devient demain
    expect(dueSoon(tasks, ["retard", "aujourd'hui", "demain"], later).map((t) => t.id)).toEqual(["après-demain"]);
  });
});
