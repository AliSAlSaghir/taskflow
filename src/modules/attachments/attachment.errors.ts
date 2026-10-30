export class AttachmentNotFoundError extends Error {
  constructor() {
    super("The requested attachment was not found.");
    this.name = "AttachmentNotFoundError";
  }
}

export class AttachmentForbiddenError extends Error {
  constructor() {
    super("You are not allowed to manage attachments for this task.");
    this.name = "AttachmentForbiddenError";
  }
}

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

export class AttachmentStorageError extends Error {
  constructor() {
    super("The attachment storage operation failed.");
    this.name = "AttachmentStorageError";
  }
}

export class AttachmentResourceArchivedError extends Error {
  constructor() {
    super("Attachments cannot be modified on archived resources.");
    this.name = "AttachmentResourceArchivedError";
  }
}
