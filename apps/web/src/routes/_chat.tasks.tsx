import { createFileRoute } from "@tanstack/react-router";

import { MyTasksPage } from "../components/inbox/MyTasksPage";

export const Route = createFileRoute("/_chat/tasks")({
  component: MyTasksPage,
});
