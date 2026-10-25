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

export class TaskNotFoundError extends Error {
  constructor() {
    super("The requested task was not found.");
    this.name = "TaskNotFoundError";
  }
}

export class TaskUpdateForbiddenError extends Error {
  constructor() {
    super("You are not allowed to update this task.");
    this.name = "TaskUpdateForbiddenError";
  }
}
