export class ProfileNotFoundError extends Error {
  constructor() {
    super("The requested profile was not found.");
    this.name = "ProfileNotFoundError";
  }
}

export class ProfilePictureNotFoundError extends Error {
  constructor() {
    super("The profile picture was not found.");
    this.name = "ProfilePictureNotFoundError";
  }
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export class ProfileStorageError extends Error {
  constructor() {
    super("The profile picture storage operation failed.");
    this.name = "ProfileStorageError";
  }
}
