import Timetable from "../models/timetable.js";
import Attendance from "../models/Attendance.js";

/* ======================================================
   ATTENDANCE CONFIG
====================================================== */

const ATTENDANCE_TIMEZONE = process.env.ATTENDANCE_TIMEZONE || "Asia/Karachi";

const ATTENDANCE_CENTER_LAT = Number(
  process.env.ATTENDANCE_CENTER_LAT || "24.9325"
);

const ATTENDANCE_CENTER_LNG = Number(
  process.env.ATTENDANCE_CENTER_LNG || "67.1125"
);

const ATTENDANCE_RADIUS_METERS = Number(
  process.env.ATTENDANCE_RADIUS_METERS || "200"
);

const MAX_ACCURACY_TOLERANCE_METERS = 50;

/* ======================================================
   TIME SLOT HELPERS
====================================================== */

const TIME_SLOT_MINUTES = {
  "8:30 - 9:20": { start: 8 * 60 + 30, end: 9 * 60 + 20 },
  "9:30 - 10:20": { start: 9 * 60 + 30, end: 10 * 60 + 20 },
  "10:30 - 11:20": { start: 10 * 60 + 30, end: 11 * 60 + 20 },
  "11:30 - 12:20": { start: 11 * 60 + 30, end: 12 * 60 + 20 },
  "12:30 - 1:20": { start: 12 * 60 + 30, end: 13 * 60 + 20 },
  "1:30 - 2:20": { start: 13 * 60 + 30, end: 14 * 60 + 20 },
  "2:30 - 3:20": { start: 14 * 60 + 30, end: 15 * 60 + 20 },
  "3:30 - 4:30": { start: 15 * 60 + 30, end: 16 * 60 + 30 },
};

const getTimeRange = (time) => {
  return TIME_SLOT_MINUTES[time] || null;
};

const getCurrentDateTimeInTimezone = () => {
  // LOCAL TESTING ONLY:
  // 17 August 2026, 08:45 AM in Asia/Karachi
  const now = new Date("2026-08-17T03:45:00.000Z");

  return {
    now,
    dateKey: "2026-08-17",
    minutes: 8 * 60 + 45,
  };
};

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

/* ======================================================
   GEO HELPERS
====================================================== */

const toRad = (value) => (value * Math.PI) / 180;

const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
  const earthRadius = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
};

const isValidCoordinate = (latitude, longitude) => {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

/* ======================================================
   ABSENT RECORD HELPERS
   Creates real MongoDB records for missed meeting slots.
====================================================== */

const hasSlotEnded = (slot, nowInfo) => {
  const slotDate = toDateKey(slot.date);
  const range = getTimeRange(slot.time);

  if (!slotDate || !range) return false;

  if (slotDate < nowInfo.dateKey) return true;

  if (slotDate === nowInfo.dateKey && nowInfo.minutes > range.end) {
    return true;
  }

  return false;
};

const createAbsentRecordIfMissing = async ({ studentId, timetable, slot }) => {
  const slotDateKey = toDateKey(slot.date);

  if (!studentId || !timetable?._id || !slot?._id || !slotDateKey) return;

  await Attendance.updateOne(
    {
      student: studentId,
      dateKey: slotDateKey,
      slotId: String(slot._id),
    },
    {
      $setOnInsert: {
        student: studentId,
        timetable: timetable._id,
        slotId: String(slot._id),
        dateKey: slotDateKey,
        day: slot.day,
        time: slot.time,
        meetingTitle: slot.label || "Meeting",
        status: "absent",
        markedAt: null,
        latitude: null,
        longitude: null,
        accuracy: null,
        distanceMeters: null,
        withinGeofence: false,
      },
    },
    { upsert: true }
  );
};

const createMissingAbsencesForDate = async (
  dateKey,
  nowInfo,
  studentIdFilter = null
) => {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

  const query = studentIdFilter ? { student: studentIdFilter } : {};

  const timetables = await Timetable.find(query).populate(
    "student",
    "name email picture"
  );

  for (const timetable of timetables) {
    const studentId = timetable.student?._id || timetable.student;

    if (!studentId) continue;

    const meetingSlots = (timetable.slots || []).filter((slot) => {
      return (
        slot.status === "meeting" &&
        toDateKey(slot.date) === dateKey &&
        hasSlotEnded(slot, nowInfo)
      );
    });

    for (const slot of meetingSlots) {
      try {
        await createAbsentRecordIfMissing({
          studentId,
          timetable,
          slot,
        });
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
  }
};

/* ======================================================
   STATUS HELPERS
====================================================== */

const getComputedStatus = (slot, attendanceRecord, nowInfo) => {
  if (attendanceRecord?.status === "present") return "present";
  if (attendanceRecord?.status === "absent") return "absent";

  const slotDate = toDateKey(slot.date);
  const range = getTimeRange(slot.time);

  if (!range) return "invalid";

  if (slotDate > nowInfo.dateKey) return "upcoming";
  if (slotDate < nowInfo.dateKey) return "absent";

  if (nowInfo.minutes < range.start) return "upcoming";
  if (nowInfo.minutes >= range.start && nowInfo.minutes <= range.end) {
    return "open";
  }

  return "absent";
};

const serializeMeetingSlot = (slot, timetable, attendanceRecord, nowInfo) => {
  const status = getComputedStatus(slot, attendanceRecord, nowInfo);

  return {
    slotId: String(slot._id),
    timetableId: String(timetable._id),
    dateKey: toDateKey(slot.date),
    day: slot.day,
    time: slot.time,
    title: slot.label || "Meeting",
    status,
    markedAt: attendanceRecord?.markedAt || null,
    distanceMeters: attendanceRecord?.distanceMeters ?? null,
  };
};

/* ======================================================
   STUDENT: GET TODAY'S MEETING ATTENDANCE
====================================================== */

export const getMyTodayMeetings = async (req, res) => {
  try {
    const studentId = req.user.id || req.user._id;
    const nowInfo = getCurrentDateTimeInTimezone();

    await createMissingAbsencesForDate(nowInfo.dateKey, nowInfo, studentId);

    const timetable = await Timetable.findOne({ student: studentId });

    if (!timetable) {
      return res.json({
        dateKey: nowInfo.dateKey,
        meetings: [],
      });
    }

    const todayMeetingSlots = (timetable.slots || []).filter((slot) => {
      return (
        slot.status === "meeting" &&
        toDateKey(slot.date) === nowInfo.dateKey
      );
    });

    const attendances = await Attendance.find({
      student: studentId,
      dateKey: nowInfo.dateKey,
    });

    const attendanceMap = new Map(
      attendances.map((record) => [String(record.slotId), record])
    );

    const meetings = todayMeetingSlots.map((slot) =>
      serializeMeetingSlot(
        slot,
        timetable,
        attendanceMap.get(String(slot._id)),
        nowInfo
      )
    );

    return res.json({
      dateKey: nowInfo.dateKey,
      meetings,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   STUDENT: MARK ATTENDANCE
====================================================== */

export const markAttendance = async (req, res) => {
  try {
    const studentId = req.user.id || req.user._id;
    const { slotId, latitude, longitude, accuracy } = req.body;

    if (!slotId) {
      return res.status(400).json({ message: "slotId is required" });
    }

    const userLat = Number(latitude);
    const userLng = Number(longitude);
    const userAccuracy = Number(accuracy || 0);

    if (!isValidCoordinate(userLat, userLng)) {
      return res.status(400).json({
        message: "Valid latitude and longitude are required",
      });
    }

    const timetable = await Timetable.findOne({ student: studentId });

    if (!timetable) {
      return res.status(404).json({ message: "Timetable not found" });
    }

    const slot = timetable.slots.id(slotId);

    if (!slot) {
      return res.status(404).json({ message: "Meeting slot not found" });
    }

    if (slot.status !== "meeting") {
      return res.status(400).json({
        message: "Attendance can only be marked for scheduled meetings",
      });
    }

    const slotDateKey = toDateKey(slot.date);
    const nowInfo = getCurrentDateTimeInTimezone();

    const existingAttendance = await Attendance.findOne({
      student: studentId,
      dateKey: slotDateKey,
      slotId: String(slot._id),
    });

    if (existingAttendance?.status === "present") {
      return res.json({
        message: "Attendance already marked",
        attendance: existingAttendance,
      });
    }

    if (slotDateKey !== nowInfo.dateKey) {
      return res.status(400).json({
        message: "Attendance can only be marked on the meeting date",
      });
    }

    const range = getTimeRange(slot.time);

    if (!range) {
      return res.status(400).json({
        message: "Invalid slot time",
      });
    }

    if (nowInfo.minutes < range.start) {
      return res.status(400).json({
        message: "Attendance cannot be marked before the slot time",
      });
    }

    if (nowInfo.minutes > range.end) {
      await createAbsentRecordIfMissing({
        studentId,
        timetable,
        slot,
      });

      return res.status(400).json({
        message: "Attendance cannot be marked after the slot time",
      });
    }

    const distanceMeters = getDistanceMeters(
      userLat,
      userLng,
      ATTENDANCE_CENTER_LAT,
      ATTENDANCE_CENTER_LNG
    );

    const accuracyTolerance = Math.min(
      Number.isFinite(userAccuracy) ? userAccuracy : 0,
      MAX_ACCURACY_TOLERANCE_METERS
    );

    const allowedDistance = ATTENDANCE_RADIUS_METERS + accuracyTolerance;

    if (distanceMeters > allowedDistance) {
      return res.status(403).json({
        message: "You are outside the allowed attendance location",
        distanceMeters: Math.round(distanceMeters),
        allowedRadiusMeters: ATTENDANCE_RADIUS_METERS,
      });
    }

    const attendance = await Attendance.findOneAndUpdate(
      {
        student: studentId,
        dateKey: slotDateKey,
        slotId: String(slot._id),
      },
      {
        student: studentId,
        timetable: timetable._id,
        slotId: String(slot._id),
        dateKey: slotDateKey,
        day: slot.day,
        time: slot.time,
        meetingTitle: slot.label || "Meeting",
        status: "present",
        markedAt: nowInfo.now,
        latitude: userLat,
        longitude: userLng,
        accuracy: Number.isFinite(userAccuracy) ? userAccuracy : null,
        distanceMeters,
        withinGeofence: true,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.json({
      message: "Attendance marked successfully",
      attendance,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Attendance already marked for this slot",
      });
    }

    return res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   STUDENT: ATTENDANCE HISTORY
====================================================== */

export const getMyAttendanceHistory = async (req, res) => {
  try {
    const studentId = req.user.id || req.user._id;
    const limit = Math.min(Number(req.query.limit || 30), 100);
    const nowInfo = getCurrentDateTimeInTimezone();

    const timetable = await Timetable.findOne({ student: studentId });

    if (!timetable) {
      return res.json({ history: [] });
    }

    const meetingSlots = (timetable.slots || [])
      .filter((slot) => {
        return (
          slot.status === "meeting" &&
          toDateKey(slot.date) <= nowInfo.dateKey
        );
      })
      .sort((a, b) => {
        const dateCompare = toDateKey(b.date).localeCompare(toDateKey(a.date));
        if (dateCompare !== 0) return dateCompare;

        const aRange = getTimeRange(a.time);
        const bRange = getTimeRange(b.time);

        return (bRange?.start || 0) - (aRange?.start || 0);
      })
      .slice(0, limit);

    const dateKeys = [
      ...new Set(meetingSlots.map((slot) => toDateKey(slot.date))),
    ];

    for (const dateKey of dateKeys) {
      await createMissingAbsencesForDate(dateKey, nowInfo, studentId);
    }

    const attendances =
      dateKeys.length > 0
        ? await Attendance.find({
            student: studentId,
            dateKey: { $in: dateKeys },
          })
        : [];

    const attendanceMap = new Map(
      attendances.map((record) => [
        `${record.dateKey}__${record.slotId}`,
        record,
      ])
    );

    const history = meetingSlots.map((slot) => {
      const dateKey = toDateKey(slot.date);
      const record = attendanceMap.get(`${dateKey}__${String(slot._id)}`);

      return serializeMeetingSlot(slot, timetable, record, nowInfo);
    });

    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ======================================================
   ADMIN: DAILY ATTENDANCE REPORT
====================================================== */

export const getAdminDailyReport = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    const nowInfo = getCurrentDateTimeInTimezone();
    const selectedDate = req.query.date || nowInfo.dateKey;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return res.status(400).json({
        message: "Date must be in YYYY-MM-DD format",
      });
    }

    await createMissingAbsencesForDate(selectedDate, nowInfo);

    const timetables = await Timetable.find()
      .populate("student", "name email picture")
      .sort({ updatedAt: -1 });

    const attendanceRecords = await Attendance.find({
      dateKey: selectedDate,
    });

    const attendanceMap = new Map(
      attendanceRecords.map((record) => [
        `${String(record.student)}__${record.slotId}`,
        record,
      ])
    );

    const records = [];

    for (const timetable of timetables) {
      const student = timetable.student;

      if (!student) continue;

      const meetingSlots = (timetable.slots || []).filter((slot) => {
        return (
          slot.status === "meeting" &&
          toDateKey(slot.date) === selectedDate
        );
      });

      for (const slot of meetingSlots) {
        const key = `${String(student._id)}__${String(slot._id)}`;
        const attendance = attendanceMap.get(key);
        const computedStatus = getComputedStatus(slot, attendance, nowInfo);

        records.push({
          student: {
            _id: String(student._id),
            name: student.name,
            email: student.email,
            picture: student.picture,
          },
          slotId: String(slot._id),
          dateKey: selectedDate,
          day: slot.day,
          time: slot.time,
          title: slot.label || "Meeting",
          status: computedStatus,
          markedAt: attendance?.markedAt || null,
          distanceMeters: attendance?.distanceMeters ?? null,
        });
      }
    }

    records.sort((a, b) => {
      const aRange = getTimeRange(a.time);
      const bRange = getTimeRange(b.time);
      return (aRange?.start || 0) - (bRange?.start || 0);
    });

    const totalMeetings = records.length;
    const present = records.filter((r) => r.status === "present").length;
    const absent = records.filter((r) => r.status === "absent").length;
    const open = records.filter((r) => r.status === "open").length;
    const upcoming = records.filter((r) => r.status === "upcoming").length;

    const attendanceRate =
      totalMeetings === 0 ? 0 : Math.round((present / totalMeetings) * 100);

    return res.json({
      dateKey: selectedDate,
      summary: {
        totalMeetings,
        present,
        absent,
        open,
        upcoming,
        attendanceRate,
      },
      records,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};