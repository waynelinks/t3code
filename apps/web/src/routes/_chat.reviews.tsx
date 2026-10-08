import { createFileRoute } from "@tanstack/react-router";

import { ReviewsPage } from "../components/inbox/ReviewsPage";

export const Route = createFileRoute("/_chat/reviews")({
  component: ReviewsPage,
});
