/*
  Warnings:

  - A unique constraint covering the columns `[project_id,id]` on the table `tasks` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_labels" (
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "task_labels_pkey" PRIMARY KEY ("task_id","label_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labels_project_id_id_key" ON "labels"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "labels_project_id_name_key" ON "labels"("project_id", "name");

-- CreateIndex
CREATE INDEX "task_labels_project_id_label_id_task_id_idx" ON "task_labels"("project_id", "label_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_id_key" ON "tasks"("project_id", "id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_project_id_label_id_fkey" FOREIGN KEY ("project_id", "label_id") REFERENCES "labels"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
