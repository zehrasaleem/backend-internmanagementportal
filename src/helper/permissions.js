import Task from "../models/Task.js";
import Project from "../models/Project.js";

/**
 * canManageTask
 *
 * ✅ Admin:
 *   - Can manage tasks ONLY in projects they created
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
  // Resolve project first — needed for both admin and team lead checks now
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

  if (user.role === "admin") {
    return project.createdBy?.toString() === user._id.toString();
  }

  // Check if user is team lead of this project
  if (project.teamLead?.equals(user._id)) return true;

  return false;
};