ALTER TABLE "task_labels"
DROP CONSTRAINT "task_labels_project_id_label_id_fkey";

ALTER TABLE "task_labels"
ADD CONSTRAINT "task_labels_project_id_label_id_fkey"
FOREIGN KEY ("project_id", "label_id")
REFERENCES "labels"("project_id", "id")
ON DELETE CASCADE
ON UPDATE CASCADE;
