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

export class LabelNotFoundError extends Error {
  constructor() {
    super("The requested label was not found.");
    this.name = "LabelNotFoundError";
  }
}

export class TaskLabelNotFoundError extends Error {
  constructor() {
    super("This label is not assigned to the task.");
    this.name = "TaskLabelNotFoundError";
  }
}

export class ProjectArchivedError extends Error {
  constructor() {
    super("The project is archived.");
    this.name = "ProjectArchivedError";
  }
}
