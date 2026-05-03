import Timetable from "../models/timetable.js";

// ---------------- STUDENT SAVE ----------------
export const saveTimetable = async (req, res) => {
  try {
    const { slots } = req.body;

    let timetable = await Timetable.findOne({
      student: req.user.id,
    });

    if (!timetable) {
      timetable = await Timetable.create({
        student: req.user.id,
        slots,
      });
    } else {
      timetable.slots = slots;
      await timetable.save();
    }

    res.json({ message: "Timetable saved", timetable });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---------------- STUDENT GET ----------------
export const getMyTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findOne({
      student: req.user.id,
    });

    res.json(timetable);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---------------- ADMIN GET ALL ----------------
export const getAllTimetables = async (req, res) => {
  try {
    const timetables = await Timetable.find()
      .populate("student", "name email");

    res.json(timetables);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---------------- ADMIN ASSIGN ----------------
export const assignSlot = async (req, res) => {
  try {
    const { timetableId, slotId } = req.body;

    const timetable = await Timetable.findById(timetableId);
    const slot = timetable.slots.id(slotId);

    slot.status = "assigned";
    await timetable.save();

    res.json({ message: "Slot assigned" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
