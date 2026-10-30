import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  deleteObject,
  downloadObject,
  uploadObject,
} from "../../infrastructure/storage.js";
import {
  ProfileNotFoundError,
  ProfilePictureNotFoundError,
  ProfileStorageError,
  ProfileValidationError,
} from "./profile.errors.js";
import type { UpdateProfileInput } from "./profile.schema.js";

const MAX_FILE_SIZE = 2 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type UploadedPicture = {
  mimetype: string;
  size: number;
  buffer: Buffer;
};

async function runStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ProfileStorageError();
  }
}

export async function updateProfileService(
  userId: string,
  data: UpdateProfileInput,
) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { userId: true },
  });

  if (!profile) {
    throw new ProfileNotFoundError();
  }

  return prisma.profile.update({
    where: { userId },
    data: {
      ...(data.displayName === undefined
        ? {}
        : { displayName: data.displayName }),
      ...(data.bio === undefined ? {} : { bio: data.bio }),
    },
    select: {
      displayName: true,
      bio: true,
      profilePictureKey: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

function validatePicture(file: UploadedPicture) {
  if (file.size <= 0) {
    throw new ProfileValidationError("The uploaded image is empty.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new ProfileValidationError("The image must be no larger than 2 MB.");
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.mimetype)) {
    throw new ProfileValidationError(
      "Unsupported image type. Allowed types are JPEG, PNG, and WebP.",
    );
  }

  if (!matchesDeclaredContentType(file.buffer, file.mimetype)) {
    throw new ProfileValidationError(
      "The image contents do not match the declared file type.",
    );
  }
}

function matchesDeclaredContentType(
  buffer: Buffer,
  contentType: string,
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );

    case "image/png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      );

    default:
      return false;
  }
}

export async function uploadProfilePicture(
  userId: string,
  file: UploadedPicture,
) {
  validatePicture(file);

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { profilePictureKey: true },
  });

  if (!profile) {
    throw new ProfileNotFoundError();
  }

  const newKey = `profile-pictures/${randomUUID()}`;

  await runStorageOperation(() =>
    uploadObject(newKey, file.buffer, file.mimetype),
  );

  try {
    const updatedProfile = await prisma.profile.update({
      where: { userId },
      data: { profilePictureKey: newKey },
      select: {
        displayName: true,
        bio: true,
        profilePictureKey: true,
        updatedAt: true,
      },
    });

    if (profile.profilePictureKey) {
      try {
        await deleteObject(profile.profilePictureKey);
      } catch {
        // The new picture is already active.
        // Failure to remove the old object does not undo the replacement.
      }
    }

    return updatedProfile;
  } catch (error: unknown) {
    try {
      await deleteObject(newKey);
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }
}

export async function getProfilePicture(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { profilePictureKey: true },
  });

  if (!profile) {
    throw new ProfileNotFoundError();
  }

  const pictureKey = profile.profilePictureKey;

  if (!pictureKey) {
    throw new ProfilePictureNotFoundError();
  }

  return runStorageOperation(() => downloadObject(pictureKey));
}

export async function deleteProfilePicture(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { profilePictureKey: true },
  });

  if (!profile) {
    throw new ProfileNotFoundError();
  }

  const pictureKey = profile.profilePictureKey;

  if (!pictureKey) {
    throw new ProfilePictureNotFoundError();
  }

  await prisma.profile.update({
    where: { userId },
    data: { profilePictureKey: null },
  });

  try {
    await deleteObject(pictureKey);
  } catch {
    // The profile no longer references this object.
    // Cleanup failure does not make the deletion API report a false failure.
  }

  return { deleted: true };
}
