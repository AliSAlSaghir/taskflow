import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

const isStorageConfigured =
  Boolean(env.B2_KEY_ID) &&
  Boolean(env.B2_APPLICATION_KEY) &&
  Boolean(env.B2_BUCKET_NAME) &&
  Boolean(env.B2_REGION) &&
  Boolean(env.B2_ENDPOINT);

const client = isStorageConfigured
  ? new S3Client({
      region: env.B2_REGION!,
      endpoint: env.B2_ENDPOINT!,
      credentials: {
        accessKeyId: env.B2_KEY_ID!,
        secretAccessKey: env.B2_APPLICATION_KEY!,
      },
    })
  : null;

function getStorage() {
  if (!client || !env.B2_BUCKET_NAME) {
    throw new Error("Object storage is not configured.");
  }

  return { client, bucket: env.B2_BUCKET_NAME };
}

export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { client, bucket } = getStorage();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function downloadObject(
  key: string,
): Promise<{ body: Buffer; contentType: string | undefined }> {
  const { client, bucket } = getStorage();

  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  if (!result.Body) {
    throw new Error("The stored object has no body.");
  }

  return {
    body: Buffer.from(await result.Body.transformToByteArray()),
    contentType: result.ContentType,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getStorage();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}
