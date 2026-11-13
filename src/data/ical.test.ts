/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../db";
import { migrate } from "../db/schema";
import type { Db, SqlValue } from "../db/types";
import { importEvents, layoutColumns, listEvents, setEventsCourse } from "./events";
import { clock, legacySlotKeys, matchCourse, parseIcal } from "./ical";

const ics = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "X-WR-CALNAME:Mon EDT",
    ...events.flatMap((e) => ["BEGIN:VEVENT", e, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("lecture iCal", () => {
  it("garde la date de chaque séance", () => {
    const { name, events } = parseIcal(
      ics(
        "UID:a\nDTSTART:20260914T080000\nDTEND:20260914T100000\nSUMMARY:Analyse\nLOCATION:Amphi A",
        "UID:b\nDTSTART:20260921T080000\nDTEND:20260921T100000\nSUMMARY:Analyse\nLOCATION:Amphi A",
      ),
    );
    expect(name).toBe("Mon EDT");
    expect(events.map((e) => [e.key, e.start, e.end])).toEqual([
      ["a", local(2026, 9, 14, 8), local(2026, 9, 14, 10)],
      ["b", local(2026, 9, 21, 8), local(2026, 9, 21, 10)],
    ]);
  });

  it("lit les champs d'HyperPlanning et les cours annulés", () => {
    const { events } = parseIcal(
      ics(
        [
          "UID:Cours-1",
          "DTSTART:20261121T073000Z",
          "DTEND:20261121T090000Z",
          "SUMMARY;LANGUAGE=fr:5.11 Méthodes optimisat° - M. Martin Paul - IUT 3EME ANNEE INFO - TD",
          "LOCATION;LANGUAGE=fr:IUTC-715 tp\\, IUTC-718 tp",
          "DESCRIPTION;LANGUAGE=fr:Matière : 5.11 Méthodes optimisat°\\nEnseignant : M. Martin Paul\\nSalles : IUTC",
          " -715 tp\\nMémo : 1/3 temps début 8h00\\nType : TD\\n",
        ].join("\r\n"),
        "UID:COURSANNULE-2\nDTSTART:20261122T130000Z\nDTEND:20261122T140000Z\nSUMMARY:Annulation : 5.02A PPP - L - TD\nDESCRIPTION:Annulation : \\nMatière : 5.02A PPP\\nType : TD\\n",
      ),
    );
    expect(events[0]).toMatchObject({
      title: "5.11 Méthodes optimisat°",
      start: Date.UTC(2026, 10, 21, 7, 30),
      room: "IUTC-715 tp, IUTC-718 tp",
      teacher: "M. Martin Paul",
      kind: "TD",
      note: "1/3 temps début 8h00",
      cancelled: false,
    });
    expect(events[1]).toMatchObject({ title: "5.02A PPP", cancelled: true });
  });

  it("garde les journées entières (vacances) sur plusieurs jours", () => {
    const [holiday] = parseIcal(ics("UID:F\nDTSTART;VALUE=DATE:20261024\nDTEND;VALUE=DATE:20261102\nSUMMARY:Vacances")).events;
    expect(holiday).toMatchObject({ allDay: true, start: local(2026, 10, 24), end: local(2026, 11, 2) });
  });

  it("convertit une heure donnée dans un autre fuseau (TZID)", () => {
    const [e] = parseIcal(
      ics("UID:z\nDTSTART;TZID=America/New_York:20260115T090000\nDTEND;TZID=America/New_York:20260115T100000\nSUMMARY:Call"),
    ).events;
    expect(e.start).toBe(Date.UTC(2026, 0, 15, 14));
  });

  it("développe les répétitions, sans les dates exclues ni les séances déplacées", () => {
    const { events } = parseIcal(
      ics(
        "UID:r\nDTSTART:20260907T090000\nDTEND:20260907T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=6\nEXDATE:20260910T090000\nSUMMARY:Anglais",
        "UID:r\nRECURRENCE-ID:20260914T090000\nDTSTART:20260915T140000\nDTEND:20260915T150000\nSUMMARY:Anglais",
      ),
    );
    expect(events.map((e) => [new Date(e.start).getDate(), clock(e.start)])).toEqual([
      [7, "09:00"],
      [15, "14:00"],
      [17, "09:00"],
      [21, "09:00"],
      [24, "09:00"],
    ]);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  it("borne une répétition sans fin et ignore les rappels", () => {
    const { events } = parseIcal(
      ics("UID:s\nDTSTART:20260907T090000\nDTEND:20260907T100000\nRRULE:FREQ=WEEKLY\nSUMMARY:Sport\nBEGIN:VALARM\nSUMMARY:Rappel\nEND:VALARM"),
    );
    expect(events.length).toBeGreaterThan(100);
    expect(events.length).toBeLessThanOrEqual(105);
    expect(events[0].title).toBe("Sport");
  });

  it("retrouve les créneaux de la semaine type créés par l'ancien import", () => {
    const { events } = parseIcal(ics("UID:a\nDTSTART:20260914T080000\nDTEND:20260914T100000\nSUMMARY:Analyse\nLOCATION:A"));
    expect([...legacySlotKeys(events)]).toEqual([JSON.stringify(["Analyse", 0, "08:00", "10:00", "A"])]);
  });

  it("rattache un cours à la matière dont le nom apparaît dans l'intitulé", () => {
    const courses = [
      { id: "a", title: "Algèbre" },
      { id: "al", title: "Algèbre linéaire" },
      { id: "s", title: "TD" },
    ];
    expect(matchCourse("CM Algebre lineaire - L2", courses)).toBe("al");
    expect(matchCourse("Algèbre (TD)", courses)).toBe("a");
    expect(matchCourse("Histoire", courses)).toBeNull();
    expect(matchCourse("TDA", courses)).toBeNull();
  });
});

describe("séances importées", () => {
  beforeEach(async () => {
    const raw = new DatabaseSync(":memory:");
    const db: Db = {
      persistent: false,
      run: async (sql, params = []) => void raw.prepare(sql).run(...(params as SqlValue[])),
      all: async <T>(sql: string, params: SqlValue[] = []) => raw.prepare(sql).all(...params) as T[],
      batch: async (statements) => statements.forEach((s) => raw.prepare(s.sql).run(...(s.params ?? []))),
    };
    await migrate(db);
    setDb(db);
  });

  it("met à jour un calendrier réimporté sans perdre la matière choisie", async () => {
    const v1 = parseIcal(
      ics(
        "UID:1\nDTSTART:20260914T080000\nDTEND:20260914T100000\nSUMMARY:Analyse",
        "UID:2\nDTSTART:20260915T080000\nDTEND:20260915T100000\nSUMMARY:Physique",
      ),
    );
    expect(await importEvents("EDT", v1.events, [])).toEqual({ added: 2, updated: 0, removed: 0 });
    await setEventsCourse("EDT", "Analyse", "maths");

    const v2 = parseIcal(
      ics(
        "UID:1\nDTSTART:20260914T090000\nDTEND:20260914T110000\nSUMMARY:Analyse",
        "UID:3\nDTSTART:20260921T080000\nDTEND:20260921T100000\nSUMMARY:Analyse",
      ),
    );
    expect(await importEvents("EDT", v2.events, [])).toEqual({ added: 1, updated: 1, removed: 1 });
    const rows = await listEvents(0, Infinity);
    expect(rows.map((r) => [r.title, clock(r.start), r.course_id])).toEqual([
      ["Analyse", "09:00", "maths"],
      ["Analyse", "08:00", "maths"],
    ]);
    // Réimporter le même fichier ne réécrit rien.
    expect(await importEvents("EDT", v2.events, [])).toEqual({ added: 0, updated: 0, removed: 0 });
  });
});

describe("disposition", () => {
  it("place côte à côte les séances qui se chevauchent", () => {
    const out = layoutColumns([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 540, end: 660 },
      { id: "c", start: 600, end: 720 },
      { id: "d", start: 780, end: 840 },
    ]);
    expect(out.map((o) => [o.id, o.col, o.cols])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ]);
  });
});
