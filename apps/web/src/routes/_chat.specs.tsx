import { createFileRoute } from "@tanstack/react-router";

import { SpecsPage } from "../components/inbox/SpecsPage";

export const Route = createFileRoute("/_chat/specs")({
  validateSearch: (search: Record<string, unknown>): { spec?: string } =>
    typeof search.spec === "string" && search.spec ? { spec: search.spec } : {},
  component: SpecsPage,
});
