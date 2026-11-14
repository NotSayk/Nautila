import { describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { dayKey, keyNoon } from "./stats";
import { listTasks, nextDue, occurrenceId, setTaskDone, type Task } from "./tasks";

const at = (key: string) => keyNoon(key);
const next = (due: string | null, rec: Parameters<typeof nextDue>[1], today: string) =>
  dayKey(nextDue(due === null ? null : at(due), rec, at(today)));

describe("devoirs récurrents", () => {
  it("avance d'une période après l'échéance", () => {
    expect(next("2026-03-02", "daily", "2026-03-02")).toBe("2026-03-03");
    expect(next("2026-03-02", "weekly", "2026-03-02")).toBe("2026-03-09");
    expect(next("2026-03-02", "biweekly", "2026-03-02")).toBe("2026-03-16");
    expect(next("2026-03-15", "monthly", "2026-03-15")).toBe("2026-04-15");
  });

  it("un devoir fait en avance passe à la période suivante, pas à demain", () => {
    expect(next("2026-03-09", "weekly", "2026-03-02")).toBe("2026-03-16");
  });

  it("un devoir en retard saute les occurrences déjà passées", () => {
    expect(next("2026-03-02", "weekly", "2026-03-20")).toBe("2026-03-23");
    expect(next("2026-01-10", "monthly", "2026-03-10")).toBe("2026-04-10");
  });

  it("le mois se borne au dernier jour (31 janvier → 28 février, 29 en année bissextile)", () => {
    expect(next("2026-01-31", "monthly", "2026-01-31")).toBe("2026-02-28");
    expect(next("2028-01-31", "monthly", "2028-01-31")).toBe("2028-02-29");
    expect(next("2026-08-31", "monthly", "2026-08-31")).toBe("2026-09-30");
  });

  it("sans date, part d'aujourd'hui", () => {
    expect(next(null, "weekly", "2026-03-02")).toBe("2026-03-09");
  });

  it("identifiant d'occurrence déterministe et sans empilement de suffixes", () => {
    expect(occurrenceId("abc", at("2026-03-09"))).toBe("abc@2026-03-09");
    expect(occurrenceId("abc@2026-03-09", at("2026-03-16"))).toBe("abc@2026-03-16");
  });

  it("cocher crée l'occurrence suivante une seule fois, décocher la retire", async () => {
    const db = await migratedDb();
    await db.run(
      "INSERT INTO tasks (id, title, kind, course_id, due_at, done, created_at, recurrence) VALUES ('t', 'TD', 'homework', NULL, ?, 0, 1, 'weekly')",
      [at("2026-03-02")],
    );
    const task = (await listTasks())[0] as Task;
    const now = at("2026-03-02");
    expect(await setTaskDone(task, true, now)).toBe("t@2026-03-09");
    await setTaskDone(task, true, now);
    let rows = await listTasks();
    expect(rows.map((r) => [r.id, r.done, r.recurrence])).toEqual([
      ["t@2026-03-09", 0, "weekly"],
      ["t", 1, "weekly"],
    ]);
    await setTaskDone(task, false, now);
    rows = await listTasks();
    expect(rows.map((r) => r.id)).toEqual(["t"]);
  });

  it("une récurrence inconnue (client plus récent) reste un devoir ponctuel", async () => {
    const db = await migratedDb();
    await db.run("INSERT INTO tasks (id, title, created_at, recurrence) VALUES ('u', 'X', 1, 'yearly')");
    const task = (await listTasks())[0] as Task;
    expect(await setTaskDone(task, true)).toBeNull();
    expect((await listTasks()).map((r) => [r.id, r.done])).toEqual([["u", 1]]);
  });
});
