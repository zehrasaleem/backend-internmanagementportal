import Project from "../models/project.js";
import Timetable from "../models/timetable.js";

/* ======================================================
ACADEMIC CALENDAR HELPERS
====================================================== */

const MIN_ALLOWED_DATE_KEY = "2026-08-17";

const toDateKey = (value) => {
  if (!value) return "";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

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
    return Boolean(getSpringSemester(year) || getSpringSemester(year + 1));
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
  const nextSpring = getSpringSemester(year + 1);
  const fall = getFallSemester(year);

  return Boolean(
    (spring && dateKey >= spring.start && dateKey <= spring.end) ||
      (nextSpring && dateKey >= nextSpring.start && dateKey <= nextSpring.end) ||
      (fall && dateKey >= fall.start && dateKey <= fall.end)
  );
};

/**
 * TEAM LEAD: get timetables for students under projects where req.user is teamLead
 * Returns: Timetable[] populated with student name/email
 */
export const getTeamLeadStudentTimetables = async (req, res) => {
  try {
    const leadId = req.user?._id;
    if (!leadId) return res.status(401).json({ message: "Not authorized" });

    // find projects where current user is teamLead
    const projects = await Project.find({ teamLead: leadId }).select("assignedTo");

    const studentIds = [
      ...new Set(
        projects
          .flatMap((p) => (Array.isArray(p.assignedTo) ? p.assignedTo : []))
          .map((id) => String(id))
      ),
    ];

    if (studentIds.length === 0) return res.json([]);

    const timetables = await Timetable.find({ student: { $in: studentIds } })
      .populate("student", "name email")
      .sort({ updatedAt: -1 });

    const cleanedTimetables = timetables.map((timetable) => {
      const obj = timetable.toObject();

      obj.slots = (obj.slots || [])
        .map((slot) => {
          const dk = toDateKey(slot.date);
          if (!dk || !isAcademicDateKey(dk)) return null;

          return {
            ...slot,
            date: dk,
            meetingDate: slot.meetingDate ? toDateKey(slot.meetingDate) : "",
          };
        })
        .filter(Boolean);

      return obj;
    });

    return res.json(cleanedTimetables);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};