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
import sharp from "sharp";

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

const MAX_IMAGE_WIDTH = 4096;
const MAX_IMAGE_HEIGHT = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_PROCESSED_FILE_SIZE = 1 * 1024 * 1024;

async function processPicture(file: UploadedPicture): Promise<Buffer> {
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

  try {
    const image = sharp(file.buffer, {
      limitInputPixels: MAX_IMAGE_WIDTH * MAX_IMAGE_HEIGHT,
      failOn: "error",
    });

    const metadata = await image.metadata();

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_IMAGE_WIDTH ||
      metadata.height > MAX_IMAGE_HEIGHT ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    ) {
      throw new ProfileValidationError("The image dimensions are too large.");
    }

    if ((metadata.pages ?? 1) > 1) {
      throw new ProfileValidationError("Animated images are not supported.");
    }

    const expectedFormat = (
      {
        "image/jpeg": "jpeg",
        "image/png": "png",
        "image/webp": "webp",
      } as const
    )[file.mimetype];

    if (metadata.format !== expectedFormat) {
      throw new ProfileValidationError(
        "The image contents do not match the declared file type.",
      );
    }

    const processedBuffer = await image
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    if (processedBuffer.length > MAX_PROCESSED_FILE_SIZE) {
      throw new ProfileValidationError("The processed image is too large.");
    }

    return processedBuffer;
  } catch (error: unknown) {
    if (error instanceof ProfileValidationError) {
      throw error;
    }

    throw new ProfileValidationError(
      "The uploaded image is invalid or corrupted.",
    );
  }
}

export async function uploadProfilePicture(
  userId: string,
  file: UploadedPicture,
) {
  const processedBuffer = await processPicture(file);

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { profilePictureKey: true },
  });

  if (!profile) {
    throw new ProfileNotFoundError();
  }

  const newKey = `profile-pictures/${randomUUID()}`;

  await runStorageOperation(() =>
    uploadObject(newKey, processedBuffer, "image/webp"),
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
