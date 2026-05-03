import express from "express";
import Task from "../models/Task.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import { canManageTask } from "../helper/permissions.js";
import Project from "../models/project.js";
// utils/taskUtils.js OR at top of task routes file
const isTaskMissed = (task) => {
  if (task.completedDate) return false;

  const due = new Date(task.dueDate);
  due.setHours(23, 59, 59, 999);
  return new Date() > due;
};

const handleCompletionDates = (task, newStatus) => {
  const now = new Date();

  // Set startDate when task begins
  if (newStatus === "In Progress" && !task.startDate) {
    task.startDate = now;
  }

  // Set completedDate when task is completed
  if (newStatus === "Completed" && !task.completedDate) {
    task.completedDate = now;
  }

  // Clear completedDate only if reopening the task
  if (["Assigned", "In Progress"].includes(newStatus) && task.completedDate) {
    task.completedDate = null;
  }
};



const router = express.Router();

/* ---------------------------------------------
   📘 CREATE NEW TASK (Admin or Team Lead)
--------------------------------------------- */
router.post("/", protect, async (req, res) => {
  try {
    const { project, title, description, assignedTo, dueDate, status, subHeading } = req.body;

    if (!title || !assignedTo?.length || !dueDate) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    // Fetch project once
    const projectDoc = await Project.findById(project)
      .populate("teamLead assignedTo", "email");
    if (!projectDoc) return res.status(404).json({ success: false, message: "Project not found." });

    // Check admin or team lead permission
    const allowed = await canManageTask(req.user, project, true);
    if (!allowed) return res.status(403).json({
      success: false,
      message: "Access denied. Only admins or project lead can create tasks in this project."
    });

    // Student acting as team lead
    const isStudentTeamLead = req.user.role === "student" &&
      projectDoc.teamLead.toString() === req.user._id.toString();

    // ---------- ASSIGNMENT CHECKS ----------
    // ---------- ASSIGNMENT CHECKS ----------
    if (req.user.role === "admin") {
      if (!projectDoc.teamLead) return res.status(400).json({ success: false, message: "Project has no team lead assigned." });
      if (assignedTo.length !== 1 || assignedTo[0] !== projectDoc.teamLead.email) {
        return res.status(403).json({ success: false, message: "Admin can only assign tasks to the project team lead." });
      }
    }

    if (req.user.role === "teamLead" || isStudentTeamLead) {
      const allowedEmails = projectDoc.assignedTo.map(s => s.email);
      if (projectDoc.teamLead) allowedEmails.push(projectDoc.teamLead.email); // allow assigning to self
      const invalidEmails = assignedTo.filter(email => !allowedEmails.includes(email));
      if (invalidEmails.length > 0) return res.status(403).json({
        success: false,
        message: "Team lead can assign tasks only to project students or self.",
        invalidEmails
      });

      // 🚨 New Rule: TL cannot be assigned along with other students
      if (assignedTo.includes(projectDoc.teamLead.email) && assignedTo.length > 1) {
        return res.status(403).json({
          success: false,
          message: "Cannot assign Team Lead together with other students."
        });
      }
    }


    // ---------- FETCH USERS ----------
    const users = await User.find({ email: { $in: assignedTo } });
    if (users.length !== assignedTo.length) {
      return res.status(400).json({
        success: false,
        message: req.user.role === "admin"
          ? "Assigned user not found."
          : "All assigned students must belong to this project.",
      });
    }

    // ---------- CREATE TASK ----------
    const newTask = await Task.create({
      title,
      subHeading: subHeading || "",
      description: description || "",
      assignedTo: users.map(u => u._id),
      assignedBy: req.user._id,
      createdByRole: req.user.role,
      project,
      dueDate,
      status: status || "Assigned",
    });
    // Debug: check task object before saving
console.log("🧪 Saving task to DB:", newTask);

    const populatedTask = await Task.findById(newTask._id)
      .populate([
        { path: "assignedTo", select: "name email role" },
        { path: "assignedBy", select: "name email role" },
      ]);

    populatedTask.progress = populatedTask.progress;

    res.status(201).json({ success: true, message: "Task created successfully.", task: populatedTask });

  } catch (error) {
    console.error("❌ Error creating task:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* ---------------------------------------------
   📗 GET ALL TASKS (Admin / Team Lead)
--------------------------------------------- */
router.get("/", protect, async (req, res) => {
  try {
    let tasks = [];

    /* ---------------- ADMIN ---------------- */
    if (req.user.role === "admin") {
      tasks = await Task.find()
        .populate("assignedTo", "name email")
        .populate("assignedBy", "name email")
        .populate({ path: "project", select: "title teamLead" });

      tasks = tasks.map(task => {
        task.canApprove = true; // Admin can approve everything
        return task;
      });

      return res.json({ tasks });
    }

    /* ---------------- TEAM LEAD / STUDENT ---------------- */
    // Fetch projects where user is TL
    const leadProjects = await Project.find({ teamLead: req.user._id }).select("_id");
    const leadProjectIds = leadProjects.map(p => p._id.toString());

    // Fetch tasks assigned to this user (student role)
    const studentTasks = await Task.find({ assignedTo: req.user._id })
      .populate("assignedTo", "name email")
      .populate("assignedBy", "name email")
      .populate({ path: "project", select: "title teamLead" });

    // Fetch tasks for projects where user is TL
    let leadTasks = [];
    if (leadProjectIds.length > 0) {
      leadTasks = await Task.find({ project: { $in: leadProjectIds } })
        .populate("assignedTo", "name email")
        .populate("assignedBy", "name email")
        .populate({ path: "project", select: "title teamLead" });
    }

    // Combine tasks and remove duplicates
    const allTasksMap = {};
    [...studentTasks, ...leadTasks].forEach(task => {
      allTasksMap[task._id] = task;
    });
    tasks = Object.values(allTasksMap);

    // Mark missed tasks and set canApprove
    tasks = tasks.map(task => {
      const isMissed = isTaskMissed(task);
      if (isMissed && !["Pending Start Approval", "Pending Approval"].includes(task.status)) {
        task.status = "Missed";
      }

      // Determine if user can approve this task
      // Make sure teamLeadId is always a string
      const teamLeadId = task.project.teamLead?._id?.toString() || task.project.teamLead?.toString();
      const isLead = teamLeadId === req.user._id.toString();
      task.canApprove = isLead && ["Missed", "Pending TL Approval", "Pending Admin Approval"].includes(task.status);


      return task;
    });

    res.json({ tasks });

  } catch (err) {
    console.error("❌ Error fetching tasks:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /:id/tl-reset-missed
router.put("/:id/tl-reset-missed", protect, async (req, res) => {
  try {
    if (req.user.role !== "teamLead") {
      return res.status(403).json({ success: false, message: "Only Team Leads allowed." });
    }

    const { newDueDate, resetTo = "Assigned" } = req.body;
    if (!newDueDate) {
      return res.status(400).json({ message: "New due date is required." });
    }

    const task = await Task.findById(req.params.id).populate("project");
    if (!task) return res.status(404).json({ message: "Task not found." });

    // Only TL of the project can reset
    if (task.project.teamLead.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not the TL of this project." });
    }

    if (!isTaskMissed(task)) {
      return res.status(400).json({ message: "Task is not missed." });
    }

    const dueDateObj = new Date(newDueDate);
    if (isNaN(dueDateObj.getTime()) || dueDateObj <= new Date()) {
      return res.status(400).json({ message: "New due date must be in the future." });
    }

    task.dueDate = dueDateObj;
    task.status = resetTo; // Assigned or In Progress
    task.startDate = resetTo === "In Progress" ? new Date() : null;
    task.completedDate = null;
    // ✅ Reset progress if task is being reassigned
    if (resetTo === "Assigned" || resetTo === "In Progress") {
      task.progress = 0;
    }

    await task.save();
    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    res.json({ success: true, message: "Task reset successfully by TL.", task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});


/* 
---------------------------------------------
📘 GET TASKS BY STUDENT EMAIL
---------------------------------------------
*/
/* ---------------------------------------------
   📘 GET TASKS BY STUDENT EMAIL
--------------------------------------------- */
router.get("/student/:email", protect, async (req, res) => {
  try {
    if (req.user.role === "student" && req.user.email !== req.params.email) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const student = await User.findOne({ email: req.params.email });
    if (!student) return res.status(404).json({ success: false, message: "No user found with that email." });

    let tasks = await Task.find({ assignedTo: student._id })
      .populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" },
        { path: "project", select: "title teamLead" },
      ])
      .sort({ dueDate: 1 });

    tasks = tasks.map(task => {
      const isMissed = isTaskMissed(task);
      if (isMissed && !["Pending Start Approval", "Pending Approval"].includes(task.status)) {
        task.status = "Missed";
      }

      const isLead = task.project.teamLead?.toString() === req.user._id.toString();
      task.canApprove = isLead && ["Missed", "Pending TL Approval", "Pending Admin Approval"].includes(task.status);

      return task;
    });

    res.status(200).json({ success: true, tasks });

  } catch (error) {
    console.error("❌ Error fetching student tasks:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟡 UPDATE TASK STATUS
---------------------------------------------
*/
router.put("/:id/status", protect, async (req, res) => {
  try {
    const { status } = req.body;

    const validStatuses = [
      "Assigned",
      "In Progress",
      "Completed",
      "Pending Approval",
      "Pending TL Approval",
      "Pending Admin Approval",
      "Pending Start Approval",
      "Rejected",
    ];

    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status value." });
    }

    const task = await Task.findById(req.params.id)
      .populate("project")
      .populate("assignedTo", "progress name email");

    if (!task) {
      return res
        .status(404)
        .json({ success: false, message: "Task not found." });
    }

    const project = await Project.findById(task.project?._id);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found." });
    }

    const isProjectLead =
      req.user.role === "teamLead" ||
      (req.user.role === "student" &&
        project.teamLead.toString() === req.user._id.toString());

    /* ============================
       MISSED TASK RULE
       ============================ */
    if (isTaskMissed(task) && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Task is missed. Admin must reset it.",
      });
    }

    /* ============================
       STUDENT RESTRICTION
       ============================ */
    if (req.user.role === "student" && !isProjectLead) {
      return res.status(403).json({
        success: false,
        message: "Students cannot change task status manually.",
      });
    }
    /* ============================
       ADMIN LOGIC
       ============================ */
    if (req.user.role === "admin") {
      task.status = status;
      handleCompletionDates(task, status);
      task.adminApproved = status === "Completed";

      await task.save();
      await task.populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" },
      ]);

      return res.json({ success: true, task });
    }

    /* ============================
       TEAM LEAD / PROJECT LEAD
       ============================ */
    if (isProjectLead) {
      const missed = isTaskMissed(task);

      if (
        !missed &&
        (status === "Pending Approval" || status === "Rejected")
      ) {
        if (task.progress !== 100) {
          return res.status(403).json({
            success: false,
            message:
              "Cannot approve or reject task until all assigned students have 100% progress.",
          });
        }
      }

      task.status = status;
      handleCompletionDates(task, status);
      // Make sure completedDate is set after status update
      if (task.status === "Completed" && !task.completedDate) {
        task.completedDate = new Date();
      }

      await task.save();
      await task.populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" },
      ]);

      return res.json({ success: true, task });
    }

    /* ============================
       FALLBACK
       ============================ */
    return res
      .status(403)
      .json({ success: false, message: "Access denied." });
  } catch (error) {
    console.error("❌ Error updating task status:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
🟢 UPDATE TASK PROGRESS (0–100)
---------------------------------------------
*/
router.put("/:id/progress", protect, async (req, res) => {
  try {
    const { progress } = req.body;

    if (progress === undefined || progress < 0 || progress > 100) {
      return res.status(400).json({ success: false, message: "Progress must be between 0 and 100." });
    }

    const task = await Task.findById(req.params.id)
      .populate("assignedTo assignedBy project");
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });
    if (isTaskMissed(task)) {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Task is missed. Admin must reset it."
        });
      }
    }


    const isAssigned = task.assignedTo.some(u => u._id.equals(req.user._id));
    if (req.user.role === "student" && !isAssigned) {
      return res.status(403).json({ success: false, message: "You are not assigned to this task." });
    }

    // Block updating progress if task is already in approval stages or completed
    if (["Completed", "Pending TL Approval", "Pending Admin Approval", "Rejected"].includes(task.status)) {
      return res.status(400).json({ success: false, message: "Cannot update progress for this task currently." });
    }

    // Update progress
    task.progress = progress;
    if (!task.startDate) task.startDate = new Date();
    if (req.user.role === "student" && task.status === "Assigned") task.status = "In Progress";

    // Check if progress is 100% → determine next step
    if (progress === 100) {
      const project = await Project.findById(task.project._id);
      const teamLeadId = project.teamLead?.toString();

      const assignedToTL = task.assignedTo.some(u => u._id.toString() === teamLeadId);
      const isTLCompletingOwnTask = req.user.role === "teamLead" && req.user._id.toString() === teamLeadId;

      if (assignedToTL && isTLCompletingOwnTask) {
        // TL completing own task → goes to Admin Approval
        task.status = "Pending Admin Approval";
      } else if (assignedToTL) {
        // Multiple students including TL → Admin approves TL portion first
        task.status = "Pending Admin Approval";
      } else {
        // Only students → goes to TL approval
        task.status = "Pending TL Approval";
      }
    }
    if (task.status === "Completed" && !task.completedDate) {
      task.completedDate = new Date();
    }

    await task.save();
    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" },
    ]);

    res.json({ success: true, task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


/* 
---------------------------------------------
🟡 REQUEST TASK START APPROVAL (Student)
---------------------------------------------
*/
router.put("/:id/request-start", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    // Must be assigned
    if (!task.assignedTo.some(id => id.equals(req.user._id))) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this task."
      });
    }

    // Prevent duplicate request
    if (task.status === "Pending Start Approval") {
      return res.status(400).json({
        success: false,
        message: "Already requested admin approval."
      });
    }

    // ✅ IMPORTANT: Missed tasks ARE allowed to request admin approval
    task.status = "Pending Start Approval";
    await task.save();

    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    return res.json({
      success: true,
      message: "Admin permission requested.",
      task
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


/* 
---------------------------------------------
🟡 ADMIN APPROVE START (Admin only)
---------------------------------------------
*/
router.put("/:id/admin-approve-start", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Admins only" });

    const { newDueDate } = req.body;
    if (!newDueDate) {
      return res.status(400).json({ success: false, message: "New due date is required when approving missed task." });
    }

    const dueDateObj = new Date(newDueDate);
    if (isNaN(dueDateObj.getTime()) || dueDateObj <= new Date()) {
      return res.status(400).json({ success: false, message: "New due date must be a valid future date." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    if (!["Pending Start Approval", "Missed"].includes(task.status)) {
      return res.status(400).json({ message: "Task is not pending approval or missed." });
    }

    task.adminApproved = true;
    task.status = "Assigned"; // or "In Progress" if you want
    task.dueDate = dueDateObj; // ✅ set new future due date
    task.startDate = null;       // reset start
    task.completedDate = null;   // reset completion
    task.progress = 0;           // ✅ reset progress to 0

    await task.save();

    await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    res.json({ success: true, message: "Task approved with new due date.", task });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});
/* 
---------------------------------------------
🟢 ASSIGN MORE STUDENTS TO EXISTING TASK (Admin only)
---------------------------------------------
*/
/* 
---------------------------------------------
🟢 ASSIGN MORE STUDENTS TO EXISTING TASK (Admin only)
---------------------------------------------
*/
router.patch("/:id/assign", protect, async (req, res) => {
  try {
    // Check if user has permission to manage this task
    const allowed = await canManageTask(req.user, req.params.id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const { assignedTo } = req.body;
    if (!assignedTo?.length) {
      return res.status(400).json({ success: false, message: "No students provided." });
    }

    if (!Array.isArray(assignedTo)) {
      return res.status(400).json({ success: false, message: "assignedTo must be an array of emails." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });

    // Ensure all assigned students belong to this project
    const users = await User.find({ email: { $in: assignedTo }, projects: task.project });
    if (users.length !== assignedTo.length) {
      return res.status(400).json({ success: false, message: "All assigned students must belong to this project." });
    }

    // 🚨 New Rule: TL cannot be assigned along with other students
    const projectDoc = await Project.findById(task.project);
    if (projectDoc?.teamLead) {
      const tlEmail = projectDoc.teamLead.toString();
      if (assignedTo.includes(tlEmail) && assignedTo.length > 1) {
        return res.status(403).json({
          success: false,
          message: "Cannot assign Team Lead together with other students."
        });
      }
    }

    // Add new students to task
    const userIds = users.map(u => u._id);
    // BEFORE updating
    if (task.status === "Completed") {
      handleCompletionDates(task, "Completed");
    }


    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { assignedTo: { $each: userIds } } },
      { new: true }
    ).populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name email" }
    ]);

    updatedTask.progress = updatedTask.progress;

    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error("❌ Error assigning students:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});


/* 
---------------------------------------------
🟡 REQUEST TASK APPROVAL (Student)
---------------------------------------------
*/
router.put("/:id/request-approval", protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate("project assignedTo");
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });

    if (!task.assignedTo.some(u => u._id.equals(req.user._id))) {
      return res.status(403).json({ success: false, message: "You are not assigned to this task." });
    }

    if (task.progress < 100) {
      return res.status(400).json({ success: false, message: "Task progress must be 100% to request approval." });
    }

    const project = await Project.findById(task.project._id);
    const teamLeadId = project.teamLead?.toString();

    const assignedToTL = task.assignedTo.some(u => u._id.toString() === teamLeadId);
    const isStudentRequesting = req.user.role === "student";

    if (isStudentRequesting && assignedToTL && task.status !== "Pending Admin Approval") {
      // Students cannot request approval while TL portion pending Admin approval
      return res.status(400).json({
        success: false,
        message: "Cannot request approval. TL portion is pending Admin approval."
      });
    }

    if (assignedToTL) {
      task.status = "Pending Admin Approval";
      await task.save();
      return res.json({
        success: true,
        message: "Task approval requested. Admin needs to approve TL portion first.",
        task
      });
    } else {
      task.status = "Pending TL Approval";
      await task.save();
      return res.json({
        success: true,
        message: "Task approval requested. Team Lead needs to approve.",
        task
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* 
---------------------------------------------
🔁 RESET / EXTEND MISSED TASK (Admin only)
---------------------------------------------
*/
router.put("/:id/reset-missed", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admins only" });
    }

    const { newDueDate, resetTo = "Assigned" } = req.body;

    if (!newDueDate) {
      return res.status(400).json({ message: "New due date is required when resetting missed task." });
    }

    const dueDateObj = new Date(newDueDate);
    if (isNaN(dueDateObj.getTime()) || dueDateObj <= new Date()) {
      return res.status(400).json({ message: "New due date must be a valid future date." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    if (task.status !== "Missed") {
      return res.status(400).json({ message: "Task is not missed." });
    }

    task.adminApproved = true;
    task.status = "Assigned"; // or "In Progress" if you want
    task.dueDate = dueDateObj; // ✅ set new future due date
    task.startDate = null;       // reset start
    task.completedDate = null;   // reset completion
    task.progress = 0;           // ✅ reset progress to 0

    await task.save();


    res.json({
      success: true,
      message: "Missed task reset successfully.",
      task
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

/* 
---------------------------------------------
🟦 FULL TASK UPDATE (Admin or Team Lead)
---------------------------------------------
*/
router.patch("/:id", protect, async (req, res) => {
  try {
    const allowed = await canManageTask(req.user, req.params.id);
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const existingTask = await Task.findById(req.params.id).populate("project assignedTo");
    if (!existingTask) return res.status(404).json({ success: false, message: "Task not found." });

    const { title, description, dueDate, assignedTo, progress, status, subHeading, project } = req.body;
    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (subHeading !== undefined) updateData.subHeading = subHeading;
    if (project !== undefined) updateData.project = project;
    if (progress !== undefined) updateData.progress = progress;
    if (status !== undefined) updateData.status = status;

    // Handle assignedTo array
    if (assignedTo !== undefined) {
      if (!Array.isArray(assignedTo)) {
        return res.status(400).json({ success: false, message: "assignedTo must be an array of emails." });
      }
      const users = await User.find({ email: { $in: assignedTo } });
      if (!users.length) return res.status(404).json({ success: false, message: "No matching users found." });
      updateData.assignedTo = users.map(u => u._id);
    }

    // ---------- RESET STATUS FOR MISSED TASKS ----------
    // ---------- RESET STATUS FOR MISSED TASKS ----------
    const isTaskMissed = (task) => {
      if (task.adminApproved) return false; // approved tasks never missed
      const due = new Date(task.dueDate);
      due.setHours(23, 59, 59, 999);
      return new Date() > due && task.status !== "Completed";
    };

    const criticalFields = ["dueDate", "assignedTo"];
    const criticalFieldChanged = criticalFields.some(field => field in updateData);

    const isResettableTask = ["Missed", "Pending Request Approval", "Pending Start Approval"].includes(existingTask.status);

    if ((req.user.role === "admin" || req.user.role === "teamLead") && isResettableTask && criticalFieldChanged) {
      const newDueDate = updateData.dueDate ? new Date(updateData.dueDate) : existingTask.dueDate;
      const now = new Date();
      if (newDueDate > now) {
        updateData.status = "Assigned";
        updateData.progress = 0; // <-- reset explicitly
        updateData.startDate = null;
        updateData.completedDate = null;
      }
    }

    const updatedTask = await Task.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate([
        { path: "assignedTo", select: "name email" },
        { path: "assignedBy", select: "name email" },
      ]);

    // ✅ Fix completedDate if status was updated to Completed
    if (updateData.status === "Completed" && !updatedTask.completedDate) {
      updatedTask.completedDate = new Date();
      await updatedTask.save();
    }

    res.json({ success: true, message: "Task updated successfully.", task: updatedTask });
  } catch (error) {
    console.error("❌ Error updating task:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/* 
---------------------------------------------
📕 DELETE TASK (Admin only)
---------------------------------------------
*/
router.delete("/:id", protect, async (req, res) => {
  const allowed = await canManageTask(req.user, req.params.id);
  console.log("REQ USER:", req.user);               // 👈 Add here
  console.log("TASK/PROJECT ID:", req.params.id);
  if (!allowed) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const deleted = await Task.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Task not found." });
    res.json({ success: true, message: "Task deleted successfully." });
  } catch (error) {
    console.error("❌ Error deleting task:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;