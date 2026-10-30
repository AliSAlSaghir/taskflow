import { randomUUID } from "node:crypto";
import {
  deleteObject,
  downloadObject,
  uploadObject,
} from "../src/infrastructure/storage.js";

const key = `attachments/connection-test-${randomUUID()}.txt`;
const content = Buffer.from("TaskFlow Backblaze B2 connection test.");
let uploaded = false;

try {
  console.log("Uploading test file...");
  await uploadObject(key, content, "text/plain");
  uploaded = true;

  console.log("Downloading test file...");
  const downloaded = await downloadObject(key);

  if (!downloaded.body.equals(content)) {
    throw new Error("Downloaded content does not match uploaded content.");
  }

  console.log("Downloaded content matches.");

  console.log("Deleting test file...");
  await deleteObject(key);
  uploaded = false;

  console.log("Backblaze B2 integration test passed.");
} catch (error) {
  console.error("Backblaze B2 integration test failed:", error);
  process.exitCode = 1;
} finally {
  if (uploaded) {
    try {
      await deleteObject(key);
      console.log("Temporary test file cleaned up.");
    } catch {
      console.error(
        "Could not clean up the temporary test file. Check the bucket before retrying.",
      );
    }
  }
}
