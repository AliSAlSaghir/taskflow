export class ProjectNotFoundError extends Error {
  constructor() {
    super("The requested project was not found.");
    this.name = "ProjectNotFoundError";
  }
}

export class TaskAssigneeNotEligibleError extends Error {
  constructor() {
    super("The user cannot be assigned to this task.");
    this.name = "TaskAssigneeNotEligibleError";
  }
}
