import { db } from "../db";

export type Slot = {
  id: string;
  course_id: string | null;
  title: string;
  /** 0 = lundi … 6 = dimanche. */
  day: number;
  /** "HH:MM" */
  start: string;
  end: string;
  room: string;
};

export const listSlots = () => db().all<Slot>("SELECT * FROM slots ORDER BY day, start");

export async function saveSlot(slot: Omit<Slot, "id"> & { id?: string }) {
  const id = slot.id ?? crypto.randomUUID();
  await db().run(
    `INSERT INTO slots (id, course_id, title, day, start, end, room) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET course_id = excluded.course_id, title = excluded.title, day = excluded.day,
       start = excluded.start, end = excluded.end, room = excluded.room`,
    [id, slot.course_id, slot.title, slot.day, slot.start, slot.end, slot.room],
  );
}

export const deleteSlot = (id: string) => db().run("DELETE FROM slots WHERE id = ?", [id]);

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
