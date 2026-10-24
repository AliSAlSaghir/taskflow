export class ProjectNotFoundError extends Error {
  constructor() {
    super("The requested project was not found.");
    this.name = "ProjectNotFoundError";
  }
}

export class MemberNotEligibleError extends Error {
  constructor() {
    super("The user cannot be added to this project.");
    this.name = "MemberNotEligibleError";
  }
}

export class MembershipAlreadyExistsError extends Error {
  constructor() {
    super("This user is already a member of the project.");
    this.name = "MembershipAlreadyExistsError";
  }
}
