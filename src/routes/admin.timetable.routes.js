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

  // January + June are fully open for Spring years
  if (month === 1 || month === 6) {
    return Boolean(getSpringSemester(year));
  }

  // August + December are fully open for Fall years
  if (month === 8 || month === 12) {
    return Boolean(getFallSemester(year));
  }

  return false;
};

const isAcademicDateKey = (dateKey) => {
  if (!dateKey) return false;

  // Keep January, June, August, and December fully open
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

const sameSlot = (slot, day, time, date) => {
  return slot.day === day && slot.time === time && toDateKey(slot.date) === date;
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

const removeDuplicateSlotsForExactDate = (
  timetable,
  targetDay,
  targetTime,
  targetDate,
  keepSlotId
) => {
  timetable.slots = timetable.slots.filter((slot) => {
    if (!sameSlot(slot, targetDay, targetTime, targetDate)) return true;
    return String(slot._id) === String(keepSlotId);
  });
};

/* ================= GET ALL ================= */
router.get("/all", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const timetables = await Timetable.find().populate("student", "name email");

    res.json(timetables);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ================= ASSIGN TASK ================= */
router.put("/assign", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { timetableId, slotId, label } = req.body;

    const timetable = await Timetable.findById(timetableId);

    if (!timetable) {
      return res.status(404).json({ message: "Timetable not found" });
    }

    const baseSlot = timetable.slots.id(slotId);

    if (!baseSlot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    const targetDate = toDateKey(baseSlot.date);
    const targetDay = baseSlot.day;
    const targetTime = baseSlot.time;

    if (!isAcademicDateKey(targetDate)) {
      return res.status(400).json({
        message: "This date is outside the allowed academic calendar",
      });
    }

    const sameSlots = timetable.slots.filter((slot) =>
      sameSlot(slot, targetDay, targetTime, targetDate)
    );

    const existingBlockedSlot = sameSlots.find(
      (slot) => slot.status === "meeting" || slot.status === "task"
    );

    if (existingBlockedSlot && existingBlockedSlot.status === "meeting") {
      return res.status(400).json({
        message: "A meeting is already scheduled for this slot",
      });
    }

    const targetSlot =
      existingBlockedSlot ||
      sameSlots.find((slot) => slot.status === "free" || slot.status === "busy") ||
      baseSlot;

    targetSlot.status = "task";
    targetSlot.label = label || "Task Assigned";
    targetSlot.meetingDate = "";
    targetSlot.assignedBy = req.user.id;

    removeDuplicateSlotsForExactDate(
      timetable,
      targetDay,
      targetTime,
      targetDate,
      targetSlot._id
    );

    await timetable.save();

    res.json({ message: "Task assigned successfully", timetable });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ================= SCHEDULE MEETING =================
   Scheduling is a projection:
   Admin selects one date/day/time.
   The meeting is projected to all same days in that academic period.
   Example:
   - selected Monday => all Mondays
   - selected Tuesday => all Tuesdays
   - selected Wednesday => all Wednesdays
   - selected Thursday => all Thursdays
   - selected Friday => all Fridays
====================================================== */
router.post("/schedule", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { timetableId, slotId, title, date, day, time } = req.body;

    const timetable = await Timetable.findById(timetableId);

    if (!timetable) {
      return res.status(404).json({ message: "Timetable not found" });
    }

    const baseSlot = timetable.slots.id(slotId);

    if (!baseSlot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    const targetDate = toDateKey(date || baseSlot.date);
    const targetDay = day || baseSlot.day;
    const targetTime = time || baseSlot.time;

    if (!isAcademicDateKey(targetDate)) {
      return res.status(400).json({
        message: "This date is outside the allowed academic calendar",
      });
    }

    const projectedDates = getAllSameDayDatesInAcademicPeriod(
      targetDate,
      targetDay
    );

    if (projectedDates.length === 0) {
      return res.status(400).json({
        message: "No valid dates found for this meeting projection",
      });
    }

    const taskConflictDate = projectedDates.find((projectedDate) => {
      return timetable.slots.some(
        (slot) =>
          sameSlot(slot, targetDay, targetTime, projectedDate) &&
          slot.status === "task"
      );
    });

    if (taskConflictDate) {
      return res.status(400).json({
        message: `Cannot schedule meeting because a task exists on ${taskConflictDate} at ${targetTime}`,
      });
    }

    for (const projectedDate of projectedDates) {
      const sameSlots = timetable.slots.filter((slot) =>
        sameSlot(slot, targetDay, targetTime, projectedDate)
      );

      let targetSlot =
        sameSlots.find((slot) => slot.status === "meeting") ||
        sameSlots.find((slot) => slot.status === "free" || slot.status === "busy");

      if (!targetSlot) {
        timetable.slots.push({
          day: targetDay,
          time: targetTime,
          date: projectedDate,
          status: "meeting",
          label: title || "Meeting",
          meetingDate: projectedDate,
          assignedBy: req.user.id,
        });

        targetSlot = timetable.slots[timetable.slots.length - 1];
      } else {
        targetSlot.status = "meeting";
        targetSlot.label = title || "Meeting";
        targetSlot.meetingDate = projectedDate;
        targetSlot.assignedBy = req.user.id;
      }

      removeDuplicateSlotsForExactDate(
        timetable,
        targetDay,
        targetTime,
        projectedDate,
        targetSlot._id
      );
    }

    await timetable.save();

    res.json({
      message: "Meeting projected successfully",
      projectedCount: projectedDates.length,
      projectedDates,
      timetable,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ================= CANCEL MEETING FOR ONE DATE ONLY =================
   Deletion is NOT a projection.
   It deletes only the exact selected date/time.
   Other projected meeting dates remain unchanged.
====================================================== */
/* ================= CANCEL MEETING FOR ONE DATE ONLY =================
   Deletion is NOT a projection.
   It cancels only the exact selected date/time.

   If an exact meeting exists for that date:
   - convert it to free.

   If the meeting is only being shown as a projected meeting:
   - create an exact free slot for that date.
   - that exact free slot overrides the projected meeting only for this date.

   Other projected meeting dates remain unchanged.
====================================================== */
router.post("/cancel-meeting", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const { timetableId, slotId, date, day, time } = req.body;

    const timetable = await Timetable.findById(timetableId);

    if (!timetable) {
      return res.status(404).json({ message: "Timetable not found" });
    }

    const baseSlot = slotId ? timetable.slots.id(slotId) : null;

    if (!baseSlot && (!date || !day || !time)) {
      return res.status(404).json({ message: "Slot not found" });
    }

    const targetDate = toDateKey(date || baseSlot.date);
    const targetDay = day || baseSlot.day;
    const targetTime = time || baseSlot.time;

    if (!isAcademicDateKey(targetDate)) {
      return res.status(400).json({
        message: "This date is outside the allowed academic calendar",
      });
    }

    const sameSlots = timetable.slots.filter((slot) =>
      sameSlot(slot, targetDay, targetTime, targetDate)
    );

    const exactTask = sameSlots.find((slot) => slot.status === "task");

    if (exactTask) {
      return res.status(400).json({
        message: "A task is assigned for this slot. Only meetings can be deleted here.",
      });
    }

    const exactMeeting = sameSlots.find((slot) => slot.status === "meeting");

    if (exactMeeting) {
      exactMeeting.status = "free";
      exactMeeting.label = "";
      exactMeeting.meetingDate = "";
      exactMeeting.assignedBy = undefined;

      removeDuplicateSlotsForExactDate(
        timetable,
        targetDay,
        targetTime,
        targetDate,
        exactMeeting._id
      );
    } else {
      if (
        !baseSlot ||
        baseSlot.status !== "meeting" ||
        baseSlot.day !== targetDay ||
        baseSlot.time !== targetTime
      ) {
        return res.status(400).json({
          message: "No meeting found for this exact date and time",
        });
      }

      timetable.slots.push({
        day: targetDay,
        time: targetTime,
        date: targetDate,
        status: "free",
        label: "",
        meetingDate: "",
        assignedBy: undefined,
      });

      const overrideSlot = timetable.slots[timetable.slots.length - 1];

      removeDuplicateSlotsForExactDate(
        timetable,
        targetDay,
        targetTime,
        targetDate,
        overrideSlot._id
      );
    }

    await timetable.save();

    res.json({
      message: "Meeting deleted for this date only",
      date: targetDate,
      day: targetDay,
      time: targetTime,
      timetable,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;