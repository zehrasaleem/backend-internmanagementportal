import Task from "../models/Task.js";
import Project from "../models/Project.js";

/**
 * canManageTask
 *
 * ✅ Admin:
 *   - Can manage everything
 *
 * ✅ Team Lead:
 *   - Can CREATE tasks in projects they lead
 *   - Can UPDATE / DELETE / ASSIGN tasks that belong to projects they lead
 *
 * ❌ Student:
 *   - Cannot manage tasks
 *
 * @param {Object} user - req.user
 * @param {String} taskIdOrProjectId - taskId OR projectId
 * @param {Boolean} isProjectId - true when creating task
 */
export const canManageTask = async (user, taskIdOrProjectId, isProjectId = false) => {
  if (user.role === "admin") return true;

  // Resolve project
  let project;
  if (isProjectId) {
    project = await Project.findById(taskIdOrProjectId);
    if (!project) return false;
  } else {
    const task = await Task.findById(taskIdOrProjectId);
    if (!task) return false;
    project = await Project.findById(task.project);
    if (!project) return false;
  }

  // ✅ Safe to log now
  console.log({
    userId: user._id,
    projectId: project._id,
    projectLead: project.teamLead,
    allowed: project.teamLead?.equals(user._id)
  });

  // Check if user is team lead of this project
  if (project.teamLead?.equals(user._id)) return true;

  return false;
};
