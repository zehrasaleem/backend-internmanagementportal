import express from "express";
import Timetable from "../models/timetable.js";
import auth from "../middleware/auth.js";

const router = express.Router();

const MIN_ALLOWED_DATE_KEY = "2026-08-17";

const toDateKey = (value) => {
  if (!value) return "";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDaysKey = (dateKey, daysToAdd) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + daysToAdd);

  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

const getFallSemester = (year) => {
  const fixed = {
    2026: { start: "2026-08-17", end: "2026-12-18" },
    2027: { start: "2027-08-16", end: "2027-12-17" },
    2028: { start: "2028-08-15", end: "2028-12-15" },
  };

  if (fixed[year]) return fixed[year];

  if (year >= 2029) {
    const yearsAfterTemplate = year - 2028;
    return {
      start: addDaysKey("2028-08-15", yearsAfterTemplate * 364),
      end: addDaysKey("2028-12-15", yearsAfterTemplate * 364),
    };
  }

  return null;
};

const getSpringSemester = (year) => {
  const fixed = {
    2027: { start: "2027-01-04", end: "2027-06-11" },
    2028: { start: "2028-01-03", end: "2028-06-09" },
    2029: { start: "2029-01-01", end: "2029-06-08" },
  };

  if (fixed[year]) return fixed[year];

  if (year >= 2030) {
    const yearsAfterTemplate = year - 2029;
    return {
      start: addDaysKey("2029-01-01", yearsAfterTemplate * 364),
      end: addDaysKey("2029-06-08", yearsAfterTemplate * 364),
    };
  }

  return null;
};

const isAlwaysOpenAcademicMonthKey = (dateKey) => {
  if (!dateKey) return false;

  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));

  // ✅ January + June are fully open for Spring years
  if (month === 1 || month === 6) {
    return Boolean(getSpringSemester(year));
  }

  // ✅ August + December are fully open for Fall years
  if (month === 8 || month === 12) {
    return Boolean(getFallSemester(year));
  }

  return false;
};

const isAcademicDateKey = (dateKey) => {
  if (!dateKey) return false;

  // ✅ ONLY CHANGE: open all slots for January, June, August, and December
  if (isAlwaysOpenAcademicMonthKey(dateKey)) return true;

  if (dateKey < MIN_ALLOWED_DATE_KEY) return false;

  const year = Number(dateKey.slice(0, 4));
  const spring = getSpringSemester(year);
  const fall = getFallSemester(year);

  return Boolean(
    (spring && dateKey >= spring.start && dateKey <= spring.end) ||
      (fall && dateKey >= fall.start && dateKey <= fall.end)
  );
};

const getDayNameFromDateKey = (dateKey) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));

  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][date.getUTCDay()];
};

const getAcademicProjectionPeriod = (dateKey) => {
  if (!isAcademicDateKey(dateKey)) return null;

  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));

  if (month >= 1 && month <= 6 && getSpringSemester(year)) {
    return {
      start: `${year}-01-01`,
      end: `${year}-06-30`,
    };
  }

  if (month >= 8 && month <= 12 && getFallSemester(year)) {
    return {
      start: `${year}-08-01`,
      end: `${year}-12-31`,
    };
  }

  return null;
};

const getAllSameDayDatesInAcademicPeriod = (selectedDate, selectedDay) => {
  const period = getAcademicProjectionPeriod(selectedDate);
  if (!period) return [];

  const dates = [];
  let current = period.start;

  while (current <= period.end) {
    if (
      isAcademicDateKey(current) &&
      getDayNameFromDateKey(current) === selectedDay
    ) {
      dates.push(current);
    }

    current = addDaysKey(current, 1);
  }

  return dates;
};

const projectStudentAvailabilitySlots = (incomingSlots) => {
  const projectedSlots = [];

  for (const slot of incomingSlots || []) {
    const dk = toDateKey(slot.date);
    if (!dk || !isAcademicDateKey(dk)) continue;

    const status = slot.status === "busy" ? "busy" : "free";
    const projectedDates = getAllSameDayDatesInAcademicPeriod(dk, slot.day);

    for (const projectedDate of projectedDates) {
      projectedSlots.push({
        day: slot.day,
        time: slot.time,
        date: projectedDate,
        status,
      });
    }
  }

  return projectedSlots;
};

const makeKey = (s) => `${s.day}__${s.time}__${s.date}`;

const statusRank = (status) => {
  if (status === "meeting") return 4;
  if (status === "task") return 3;
  if (status === "busy") return 2;
  if (status === "free") return 1;
  return 0;
};

// ✅ removes duplicates by day + time + date
// meeting/task wins over busy/free
const normalizeAndDedupeSlots = (slots) => {
  const map = new Map();

  for (const slot of slots || []) {
    const obj = slot.toObject ? slot.toObject() : slot;
    const dk = toDateKey(obj.date);

    if (!dk || !isAcademicDateKey(dk)) continue;

    const normalized = {
      ...obj,
      date: dk,
      meetingDate: obj.meetingDate ? toDateKey(obj.meetingDate) : "",
    };

    const key = makeKey(normalized);
    const existing = map.get(key);

    if (!existing || statusRank(normalized.status) > statusRank(existing.status)) {
      map.set(key, normalized);
    }
  }

  return Array.from(map.values());
};

/* ======================================================
   STUDENT — SAVE AVAILABILITY (FREE / BUSY ONLY)
   ✅ cleans legacy slots
   ✅ removes duplicate same-date/time slots
   ✅ preserves task/meeting
   ✅ student cannot overwrite meeting/task with free/busy
====================================================== */
router.post("/student", auth, async (req, res) => {
  try {
    const incomingSlots = Array.isArray(req.body?.slots) ? req.body.slots : [];

    let timetable = await Timetable.findOne({ student: req.user.id });
    if (!timetable) {
      timetable = await Timetable.create({ student: req.user.id, slots: [] });
    }

    // ✅ 1) Clean existing slots and remove duplicates
    timetable.slots = normalizeAndDedupeSlots(timetable.slots);

    // ✅ 2) Clean incoming slots and project free/busy to all same weekdays in that semester
    const cleanedIncoming = projectStudentAvailabilitySlots(incomingSlots);

    if (cleanedIncoming.length === 0) {
      await timetable.save();
      return res.json({ message: "No valid academic slots provided", timetable });
    }

    const scopeDates = new Set(cleanedIncoming.map((s) => s.date));
    const desiredMap = new Map(cleanedIncoming.map((s) => [makeKey(s), s]));

    // ✅ 3) Remove free/busy inside scope if not sent anymore
    // Keep meeting/task always
    timetable.slots = timetable.slots.filter((existing) => {
      if (!scopeDates.has(existing.date)) return true;

      if (existing.status === "task" || existing.status === "meeting") return true;

      return desiredMap.has(makeKey(existing));
    });

    // ✅ 4) Upsert incoming free/busy
    for (const desired of desiredMap.values()) {
      const existingSlotsSameKey = timetable.slots.filter(
        (slot) => makeKey(slot) === makeKey(desired)
      );

      const protectedSlot = existingSlotsSameKey.find(
        (slot) => slot.status === "task" || slot.status === "meeting"
      );

      // Student cannot overwrite admin task/meeting
      if (protectedSlot) continue;

      let existing = existingSlotsSameKey[0];

      if (!existing) {
        timetable.slots.push({ ...desired, label: "", meetingDate: "" });
      } else {
        existing.status = desired.status;
        existing.label = "";
        existing.assignedBy = undefined;
        existing.meetingDate = "";
      }
    }

    // ✅ 5) Final cleanup after upsert
    timetable.slots = normalizeAndDedupeSlots(timetable.slots);

    await timetable.save();

    res.json({ message: "Availability saved", timetable });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ================= GET STUDENT ================= */
router.get("/student", auth, async (req, res) => {
  try {
    const timetable = await Timetable.findOne({ student: req.user.id });
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;