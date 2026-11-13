import { describe, expect, it } from "vitest";
import { matchCourse, parseIcal } from "./ical";

const ics = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", e, "END:VEVENT"]), "END:VCALENDAR"].join(
    "\r\n",
  );

describe("import iCal", () => {
  it("regroupe les séances identiques d'une semaine à l'autre", () => {
    const slots = parseIcal(
      ics(
        "DTSTART:20250915T080000\nDTEND:20250915T100000\nSUMMARY:Analyse\nLOCATION:Amphi A",
        "DTSTART:20250922T080000\nDTEND:20250922T100000\nSUMMARY:Analyse\nLOCATION:Amphi A",
        "DTSTART:20251020T140000\nDTEND:20251020T160000\nSUMMARY:Examen partiel",
      ),
    );
    expect(slots).toEqual([
      { title: "Analyse", day: 0, start: "08:00", end: "10:00", room: "Amphi A", count: 2 },
      { title: "Examen partiel", day: 0, start: "14:00", end: "16:00", room: "", count: 1 },
    ]);
  });

  it("lit les lignes continuées, les caractères échappés et la durée", () => {
    const [slot] = parseIcal(
      ics("DTSTART;TZID=Europe/Paris:20250917T103000\nDURATION:PT1H30M\nSUMMARY:TD Algèbre\\, groupe 2\n  (salle B)\nLOCATION:B\\;204"),
    );
    expect(slot).toMatchObject({ title: "TD Algèbre, groupe 2 (salle B)", day: 2, start: "10:30", end: "12:00", room: "B;204" });
  });

  it("convertit les heures UTC dans le fuseau de l'appareil", () => {
    const [slot] = parseIcal(ics("DTSTART:20250915T070000Z\nDTEND:20250915T090000Z\nSUMMARY:Physique"));
    const local = new Date(Date.UTC(2025, 8, 15, 7));
    expect(slot.start).toBe(`${String(local.getHours()).padStart(2, "0")}:00`);
  });

  it("développe les répétitions hebdomadaires sur plusieurs jours", () => {
    const slots = parseIcal(
      ics("DTSTART:20250915T090000\nDTEND:20250915T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=24\nSUMMARY:Anglais"),
    );
    expect(slots.map((s) => [s.day, s.count])).toEqual([
      [0, 12],
      [3, 12],
    ]);
    const [endless] = parseIcal(ics("DTSTART:20250915T090000\nDTEND:20250915T100000\nRRULE:FREQ=WEEKLY\nSUMMARY:Sport"));
    expect(endless.count).toBe(Infinity);
  });

  it("ignore les séances annulées, les journées entières et les rappels", () => {
    const slots = parseIcal(
      ics(
        "DTSTART:20250915T080000\nDTEND:20250915T100000\nSTATUS:CANCELLED\nSUMMARY:Annulé",
        "DTSTART;VALUE=DATE:20250915\nDTEND;VALUE=DATE:20250916\nSUMMARY:Journée portes ouvertes",
        "DTSTART:20250916T080000\nDTEND:20250916T090000\nSUMMARY:Chimie\nBEGIN:VALARM\nSUMMARY:Rappel\nTRIGGER:-PT10M\nEND:VALARM",
      ),
    );
    expect(slots.map((s) => s.title)).toEqual(["Chimie"]);
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
