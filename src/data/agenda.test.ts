import { describe, expect, it } from "vitest";
import { dayClasses, type CalEvent } from "./events";
import { subtreeIds } from "./tree";

const event = (patch: Partial<CalEvent>): CalEvent => ({
  id: "e",
  calendar: "ade",
  title: "Algèbre",
  start: new Date(2026, 10, 16, 8, 0).getTime(),
  end: new Date(2026, 10, 16, 10, 0).getTime(),
  all_day: 0,
  room: "B12",
  teacher: "",
  kind: "",
  note: "",
  cancelled: 0,
  course_id: null,
  ...patch,
});
const dayStart = new Date(2026, 10, 16).getTime();
const dayEnd = new Date(2026, 10, 17).getTime();

describe("dayClasses", () => {
  const slot = { id: "s", day: 0, start: "08:00", end: "10:00", title: "algèbre ", room: "B12" };

  it("n'affiche qu'une fois un créneau identique à une séance", () => {
    const out = dayClasses([slot], [event({})], dayStart, dayEnd, 0);
    expect(out.map((c) => c.id)).toEqual(["e"]);
  });

  it("garde un créneau différent, trié par heure, et ignore les autres jours", () => {
    const other = { ...slot, id: "s2", title: "Chimie", start: "07:00", end: "08:00" };
    const wrongDay = { ...slot, id: "s3", day: 2 };
    const out = dayClasses([slot, other, wrongDay], [event({})], dayStart, dayEnd, 0);
    expect(out.map((c) => c.id)).toEqual(["s2", "e"]);
  });

  it("ignore les séances sur la journée entière", () => {
    expect(dayClasses([], [event({ all_day: 1 })], dayStart, dayEnd, 0)).toEqual([]);
  });
});

describe("subtreeIds", () => {
  const pages = [
    { id: "a", parent_id: null },
    { id: "b", parent_id: "a" },
    { id: "c", parent_id: "b" },
    { id: "d", parent_id: null },
  ];
  it("renvoie la page et tous ses descendants", () => {
    expect([...subtreeIds(pages, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...subtreeIds(pages, "d")]).toEqual(["d"]);
  });
});
