export class LabelNotFoundError extends Error {
  constructor() {
    super("Label not found.");
    this.name = "LabelNotFoundError";
  }
}

export class DuplicateLabelNameError extends Error {
  constructor() {
    super("A label with this name already exists in this project.");
    this.name = "DuplicateLabelNameError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found.");
    this.name = "ProjectNotFoundError";
  }
}

export class ArchivedProjectError extends Error {
  constructor() {
    super("Cannot manage labels in an archived project.");
    this.name = "ArchivedProjectError";
  }
}
