export class CommentProjectNotFoundError extends Error {
  constructor() {
    super("The requested project was not found.");
    this.name = "CommentProjectNotFoundError";
  }
}

export class CommentTaskNotFoundError extends Error {
  constructor() {
    super("The requested task was not found.");
    this.name = "CommentTaskNotFoundError";
  }
}

export class CommentNotFoundError extends Error {
  constructor() {
    super("The requested comment was not found.");
    this.name = "CommentNotFoundError";
  }
}

export class CommentForbiddenError extends Error {
  constructor() {
    super("You are not allowed to modify this comment.");
    this.name = "CommentForbiddenError";
  }
}

export class CommentResourceArchivedError extends Error {
  constructor() {
    super("Comments cannot be modified on archived resources.");
    this.name = "CommentResourceArchivedError";
  }
}
